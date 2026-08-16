(function () {
  const loginOverlay = document.getElementById('loginOverlay');
  const dashboard = document.getElementById('dashboard');
  const loginForm = document.getElementById('loginForm');
  const loginError = document.getElementById('loginError');
  const logoutBtn = document.getElementById('logoutBtn');
  const statsGrid = document.getElementById('statsGrid');
  const customersBody = document.getElementById('customersBody');
  const lookupsBody = document.getElementById('lookupsBody');
  const creditForm = document.getElementById('creditForm');
  const customerSearch = document.getElementById('customerSearch');
  const refreshCustomers = document.getElementById('refreshCustomers');
  const customersPager = document.getElementById('customersPager');
  const lookupsPager = document.getElementById('lookupsPager');
  const customersBulkBar = document.getElementById('customersBulkBar');
  const customersBulkCount = document.getElementById('customersBulkCount');
  const bulkCreditsInput = document.getElementById('bulkCreditsInput');
  const bulkCreditsBtn = document.getElementById('bulkCreditsBtn');
  const bulkClearBtn = document.getElementById('bulkClearBtn');
  const selectAllCustomers = document.getElementById('selectAllCustomers');
  const selectAllInTableBtn = document.getElementById('selectAllInTableBtn');

  const PAGE_SIZE = 50;
  let customersPage = 1;
  let lookupsPage = 1;
  let customersTotal = 0;
  const selectedCustomerIds = new Set();

  function show(el) {
    el.classList.remove('hidden');
  }

  function hide(el) {
    el.classList.add('hidden');
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  async function withButtonLoading(btn, fn) {
    if (!btn || btn.dataset.loading === '1') return;
    const originalHtml = btn.innerHTML;
    btn.dataset.loading = '1';
    btn.disabled = true;
    btn.classList.add('is-loading');
    btn.setAttribute('aria-busy', 'true');
    btn.innerHTML = '<span class="btn-spinner" aria-hidden="true"></span>';
    try {
      return await fn();
    } finally {
      btn.dataset.loading = '0';
      btn.disabled = false;
      btn.classList.remove('is-loading');
      btn.removeAttribute('aria-busy');
      // Skip restore if the button was removed/re-rendered (e.g. table refresh)
      if (document.body.contains(btn)) {
        btn.innerHTML = originalHtml;
      }
    }
  }

  function formatDateOnly(value) {
    if (!value) return '—';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleDateString('en-GB');
  }

  async function api(path, options) {
    const res = await fetch(path, {
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', ...(options && options.headers) },
      ...options,
    });
    if (res.headers.get('content-type') && res.headers.get('content-type').includes('text/csv')) {
      return res;
    }
    const data = await res.json().catch(function () {
      return {};
    });
    if (!res.ok) {
      const err = new Error(data.error || 'Request failed');
      err.status = res.status;
      throw err;
    }
    return data;
  }

  async function checkSession() {
    const data = await api('/api/admin/session');
    if (data.authenticated) {
      hide(loginOverlay);
      show(dashboard);
      await refreshAll();
    } else {
      show(loginOverlay);
      hide(dashboard);
    }
  }

  async function refreshAll() {
    await Promise.all([loadStats(), loadCustomers(), loadLookups()]);
  }

  async function loadStats() {
    const data = await api('/api/admin/stats');
    const items = [
      ['Total lookups', data.totalLookups],
      ['Unique VRMs', data.uniqueVrms],
      ['Customers with credits', data.customersWithCredits],
    ];
    statsGrid.innerHTML = items
      .map(function (pair) {
        return (
          '<div class="stat"><div class="label">' +
          escapeHtml(pair[0]) +
          '</div><div class="value">' +
          escapeHtml(String(pair[1])) +
          '</div></div>'
        );
      })
      .join('');
  }

  function renderPager(el, page, total, onPage) {
    const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    const safePage = Math.min(Math.max(page, 1), pages);
    const from = total === 0 ? 0 : (safePage - 1) * PAGE_SIZE + 1;
    const to = Math.min(safePage * PAGE_SIZE, total);
    el.innerHTML =
      '<span class="pager-info">' +
      (total === 0 ? 'No records' : 'Showing ' + from + '–' + to + ' of ' + total) +
      '</span>' +
      '<div class="pager-buttons">' +
      '<button type="button" class="secondary" data-pager="prev"' +
      (safePage <= 1 ? ' disabled' : '') +
      '>Previous</button>' +
      '<button type="button" class="secondary" data-pager="next"' +
      (safePage >= pages ? ' disabled' : '') +
      '>Next</button>' +
      '</div>';
    el.querySelector('[data-pager="prev"]').addEventListener('click', function () {
      if (safePage > 1) onPage(safePage - 1);
    });
    el.querySelector('[data-pager="next"]').addEventListener('click', function () {
      if (safePage < pages) onPage(safePage + 1);
    });
    return safePage;
  }

  function syncCustomerSelectionUi() {
    const boxes = customersBody.querySelectorAll('input[data-select-customer]');
    let pageSelected = 0;
    boxes.forEach(function (box) {
      const id = box.getAttribute('data-select-customer');
      const checked = selectedCustomerIds.has(id);
      box.checked = checked;
      const row = box.closest('tr');
      if (row) row.classList.toggle('is-selected', checked);
      if (checked) pageSelected += 1;
    });
    if (selectAllCustomers) {
      selectAllCustomers.checked = boxes.length > 0 && pageSelected === boxes.length;
      selectAllCustomers.indeterminate =
        pageSelected > 0 && pageSelected < boxes.length;
    }
    const count = selectedCustomerIds.size;
    customersBulkCount.textContent =
      count === 1 ? '1 selected' : count + ' selected';
    if (count > 0) show(customersBulkBar);
    else hide(customersBulkBar);

    if (selectAllInTableBtn) {
      const allSelected = customersTotal > 0 && count >= customersTotal;
      if (count > 0) {
        selectAllInTableBtn.hidden = false;
        selectAllInTableBtn.textContent = allSelected
          ? 'Unselect all ' + customersTotal
          : 'Select all ' + customersTotal;
        selectAllInTableBtn.dataset.mode = allSelected ? 'unselect' : 'select';
      } else {
        selectAllInTableBtn.hidden = true;
        selectAllInTableBtn.dataset.mode = 'select';
      }
    }
  }

  function clearCustomerSelection() {
    selectedCustomerIds.clear();
    syncCustomerSelectionUi();
  }

  async function loadCustomers() {
    const q = customerSearch.value.trim();
    const qs = new URLSearchParams({
      limit: String(PAGE_SIZE),
      offset: String((customersPage - 1) * PAGE_SIZE),
    });
    if (q) qs.set('search', q);
    const data = await api('/api/admin/customers?' + qs.toString());
    const total = Number(data.total || 0);
    customersTotal = total;
    customersPage = renderPager(customersPager, customersPage, total, function (page) {
      customersPage = page;
      loadCustomers();
    });
    customersBody.innerHTML = (data.customers || [])
      .map(function (c) {
        const id = String(c.shopify_customer_id);
        return (
          '<tr>' +
          '<td class="check-col">' +
          '<input type="checkbox" data-select-customer="' +
          escapeHtml(id) +
          '"' +
          (selectedCustomerIds.has(id) ? ' checked' : '') +
          ' aria-label="Select customer" />' +
          '</td>' +
          '<td>' +
          escapeHtml(c.name || '—') +
          '</td>' +
          '<td>' +
          escapeHtml(c.email || '—') +
          '</td>' +
          '<td>' +
          escapeHtml(c.company || '—') +
          '</td>' +
          '<td>' +
          escapeHtml(String(c.credits)) +
          '</td>' +
          '<td>' +
          escapeHtml(String(c.credits_used != null ? c.credits_used : 0)) +
          '</td>' +
          '<td>' +
          escapeHtml(formatDateOnly(c.updated_at)) +
          '</td>' +
          '<td class="actions">' +
          '<input class="small" type="number" min="0" value="' +
          escapeHtml(String(c.credits)) +
          '" data-id="' +
          escapeHtml(id) +
          '" />' +
          '<button type="button" data-save="' +
          escapeHtml(id) +
          '">Save</button>' +
          '</td>' +
          '</tr>'
        );
      })
      .join('');
    syncCustomerSelectionUi();
  }

  async function loadLookups() {
    const data = await api(
      '/api/admin/lookups?limit=' +
        PAGE_SIZE +
        '&offset=' +
        (lookupsPage - 1) * PAGE_SIZE
    );
    const total = Number(data.total || 0);
    lookupsPage = renderPager(lookupsPager, lookupsPage, total, function (page) {
      lookupsPage = page;
      loadLookups();
    });
    window.__adminLookups = data.lookups || [];
    lookupsBody.innerHTML = window.__adminLookups
      .map(function (row, index) {
        const hasVehicle = !!row.vehicle;
        return (
          '<tr>' +
          '<td>' +
          escapeHtml(formatDateOnly(row.created_at)) +
          '</td>' +
          '<td>' +
          escapeHtml(row.name || '—') +
          '</td>' +
          '<td>' +
          escapeHtml(row.email || '—') +
          '</td>' +
          '<td>' +
          (hasVehicle
            ? '<button type="button" class="linkish" data-lookup-index="' +
              index +
              '">' +
              escapeHtml(row.vrm) +
              '</button>'
            : escapeHtml(row.vrm)) +
          '</td>' +
          '<td>' +
          escapeHtml(row.make || '—') +
          '</td>' +
          '<td>' +
          escapeHtml(row.model || '—') +
          '</td>' +
          '<td>' +
          escapeHtml(row.year == null ? '—' : String(row.year)) +
          '</td>' +
          '</tr>'
        );
      })
      .join('');
  }

  loginForm.addEventListener('submit', async function (e) {
    e.preventDefault();
    hide(loginError);
    const btn = loginForm.querySelector('button[type="submit"]');
    try {
      await withButtonLoading(btn, async function () {
        await api('/api/admin/login', {
          method: 'POST',
          body: JSON.stringify({ password: document.getElementById('passwordInput').value }),
        });
        hide(loginOverlay);
        show(dashboard);
        await refreshAll();
      });
    } catch (err) {
      loginError.textContent = err.message || 'Login failed';
      show(loginError);
    }
  });

  logoutBtn.addEventListener('click', async function () {
    await withButtonLoading(logoutBtn, async function () {
      await api('/api/admin/logout', { method: 'POST', body: '{}' });
      show(loginOverlay);
      hide(dashboard);
    });
  });

  creditForm.addEventListener('submit', async function (e) {
    e.preventDefault();
    const btn = creditForm.querySelector('button[type="submit"]');
    const fd = new FormData(creditForm);
    try {
      await withButtonLoading(btn, async function () {
        await api('/api/admin/customers', {
          method: 'POST',
          body: JSON.stringify({
            email: fd.get('email'),
            credits: Number(fd.get('credits')),
          }),
        });
        creditForm.reset();
        customersPage = 1;
        await Promise.all([loadCustomers(), loadStats()]);
      });
    } catch (err) {
      alert(err.message || 'Failed to set credits');
    }
  });

  refreshCustomers.addEventListener('click', async function () {
    customersPage = 1;
    await withButtonLoading(refreshCustomers, loadCustomers);
  });

  customerSearch.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') {
      customersPage = 1;
      withButtonLoading(refreshCustomers, loadCustomers);
    }
  });

  customersBody.addEventListener('change', function (e) {
    const box = e.target.closest('input[data-select-customer]');
    if (!box) return;
    const id = box.getAttribute('data-select-customer');
    if (box.checked) selectedCustomerIds.add(id);
    else selectedCustomerIds.delete(id);
    syncCustomerSelectionUi();
  });

  selectAllCustomers.addEventListener('change', function () {
    const boxes = customersBody.querySelectorAll('input[data-select-customer]');
    boxes.forEach(function (box) {
      const id = box.getAttribute('data-select-customer');
      if (selectAllCustomers.checked) selectedCustomerIds.add(id);
      else selectedCustomerIds.delete(id);
    });
    syncCustomerSelectionUi();
  });

  selectAllInTableBtn.addEventListener('click', async function () {
    if (selectAllInTableBtn.dataset.mode === 'unselect') {
      clearCustomerSelection();
      return;
    }
    await withButtonLoading(selectAllInTableBtn, async function () {
      const q = customerSearch.value.trim();
      const qs = q ? '?search=' + encodeURIComponent(q) : '';
      const data = await api('/api/admin/customers/ids' + qs);
      (data.ids || []).forEach(function (id) {
        selectedCustomerIds.add(String(id));
      });
      customersTotal = Number(data.total || customersTotal);
    });
    // Must run after withButtonLoading restores button HTML
    syncCustomerSelectionUi();
  });

  bulkClearBtn.addEventListener('click', clearCustomerSelection);

  bulkCreditsBtn.addEventListener('click', async function () {
    const ids = Array.from(selectedCustomerIds);
    if (!ids.length) {
      alert('Select at least one customer');
      return;
    }

    const sameCreditsRaw = String(bulkCreditsInput.value || '').trim();
    const useSameCredits = sameCreditsRaw !== '';

    if (useSameCredits) {
      const credits = Number(sameCreditsRaw);
      if (!Number.isFinite(credits) || credits < 0) {
        alert('Enter a valid credits number (0 or more)');
        return;
      }
      if (
        !confirm(
          'Set ' +
            credits +
            ' credit' +
            (credits === 1 ? '' : 's') +
            ' on ' +
            ids.length +
            ' selected customer' +
            (ids.length === 1 ? '' : 's') +
            '?'
        )
      ) {
        return;
      }
      await withButtonLoading(bulkCreditsBtn, async function () {
        await api('/api/admin/customers/credits/bulk', {
          method: 'PATCH',
          body: JSON.stringify({ customer_ids: ids, credits: credits }),
        });
        clearCustomerSelection();
        bulkCreditsInput.value = '';
        await Promise.all([loadCustomers(), loadStats()]);
      });
      return;
    }

    const updates = [];
    const missing = [];
    ids.forEach(function (id) {
      const input = customersBody.querySelector('input[data-id="' + CSS.escape(id) + '"]');
      if (!input) {
        missing.push(id);
        return;
      }
      const credits = Number(input.value);
      if (!Number.isFinite(credits) || credits < 0) {
        missing.push(id);
        return;
      }
      updates.push({ customer_id: id, credits: credits });
    });

    if (missing.length) {
      alert(
        'Enter credits in each selected row on this page, or fill “Same credits for all” to update everyone selected (including other pages).'
      );
      return;
    }

    if (
      !confirm(
        'Update credits for ' +
          updates.length +
          ' selected customer' +
          (updates.length === 1 ? '' : 's') +
          ' using each row value?'
      )
    ) {
      return;
    }

    await withButtonLoading(bulkCreditsBtn, async function () {
      await api('/api/admin/customers/credits/bulk', {
        method: 'PATCH',
        body: JSON.stringify({ updates: updates }),
      });
      clearCustomerSelection();
      bulkCreditsInput.value = '';
      await Promise.all([loadCustomers(), loadStats()]);
    });
  });

  customersBody.addEventListener('click', async function (e) {
    const btn = e.target.closest('[data-save]');
    if (!btn) return;
    const id = btn.getAttribute('data-save');
    const input = customersBody.querySelector('input[data-id="' + CSS.escape(id) + '"]');
    await withButtonLoading(btn, async function () {
      await api('/api/admin/customers/' + encodeURIComponent(id) + '/credits', {
        method: 'PATCH',
        body: JSON.stringify({ credits: Number(input.value) }),
      });
      await Promise.all([loadCustomers(), loadStats()]);
    });
  });

  document.querySelectorAll('a.button[href^="/api/admin/export/"]').forEach(function (link) {
    link.addEventListener('click', function () {
      if (link.dataset.loading === '1') return;
      const originalHtml = link.innerHTML;
      link.dataset.loading = '1';
      link.classList.add('is-loading');
      link.innerHTML = '<span class="btn-spinner" aria-hidden="true"></span>';
      setTimeout(function () {
        link.dataset.loading = '0';
        link.classList.remove('is-loading');
        link.innerHTML = originalHtml;
      }, 1500);
    });
  });

  checkSession().catch(function () {
    show(loginOverlay);
    hide(dashboard);
  });

  const lookupModal = document.getElementById('lookupModal');
  const lookupModalBody = document.getElementById('lookupModalBody');
  const lookupModalTitle = document.getElementById('lookupModalTitle');
  const lookupModalClose = document.getElementById('lookupModalClose');

  function openLookupModal(row) {
    const v = row.vehicle;
    if (!v) return;
    const display = function (value) {
      return value == null || value === '' ? '—' : String(value);
    };
    function section(title, rows) {
      return (
        '<div class="result-section">' +
        '<h2>' +
        escapeHtml(title) +
        '</h2>' +
        '<table class="result-table">' +
        '<tbody>' +
        rows
          .map(function (pair) {
            return (
              '<tr>' +
              '<td class="label">' +
              escapeHtml(pair[0]) +
              '</td>' +
              '<td class="value">' +
              escapeHtml(display(pair[1])) +
              '</td>' +
              '</tr>'
            );
          })
          .join('') +
        '</tbody></table></div>'
      );
    }

    lookupModalTitle.textContent = 'VRM ' + (v.vrm || row.vrm);
    lookupModalBody.innerHTML =
      section('Customer', [
        ['Name', row.name],
        ['Email', row.email],
        ['Company', row.company],
      ]) +
      section('Summary', [
        ['VRM', v.vrm],
        ['VIN', v.vin || v.vinLast5],
        ['DVLA Make', v.make],
        ['DVLA Model', v.model],
        ['DVLA year of manufacture', v.year],
        ['Model Generation', v.modelGeneration],
        ['Model Series', v.modelSeries],
        ['Model Code', v.modelCode],
        ['Model Start Date', v.modelStartDate],
        ['Model End Date', v.modelEndDate],
      ]) +
      section('More Information', [
        ['Vehicle Type', v.vehicleType],
        ['Tax Status', v.taxStatus],
        ['Tax Due Date', v.taxDueDate],
        ['MOT Status', v.motStatus],
        ['MOT Expiry Date', v.motExpiryDate],
        ['Engine model code', v.engineModelCode],
        ['Body style', v.body],
        ['Country of origin', v.countryOfOrigin],
        ['Current colour', v.colour],
        ['Date first registered', v.dateFirstRegistered],
        ['Engine capacity', v.engineCc],
        ['Engine manufacturer', v.engineManufacturer],
        ['Number Of Gears', v.numberOfGears],
        ['Fuel type', v.fuel],
        ['Maximum power', v.maximumPower],
        ['Number of doors', v.numberOfDoors],
        ['Transmission', v.transmission],
        ['Euro Status', v.euroStatus],
        ['Issue date of latest V5', v.latestV5IssueDate],
      ]);
    show(lookupModal);
  }

  function closeLookupModal() {
    hide(lookupModal);
  }

  lookupsBody.addEventListener('click', function (e) {
    const btn = e.target.closest('[data-lookup-index]');
    if (!btn) return;
    const index = Number(btn.getAttribute('data-lookup-index'));
    const row = (window.__adminLookups || [])[index];
    if (row) openLookupModal(row);
  });

  lookupModalClose.addEventListener('click', closeLookupModal);
  lookupModal.addEventListener('click', function (e) {
    if (e.target === lookupModal) closeLookupModal();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !lookupModal.classList.contains('hidden')) {
      closeLookupModal();
    }
  });
})();
