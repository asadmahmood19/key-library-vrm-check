(function () {
  const loginOverlay = document.getElementById('loginOverlay');
  const dashboard = document.getElementById('dashboard');
  const loginForm = document.getElementById('loginForm');
  const loginError = document.getElementById('loginError');
  const logoutBtn = document.getElementById('logoutBtn');
  const statsGrid = document.getElementById('statsGrid');
  const customersBody = document.getElementById('customersBody');
  const lookupsBody = document.getElementById('lookupsBody');
  const cacheBody = document.getElementById('cacheBody');
  const creditForm = document.getElementById('creditForm');
  const customerSearch = document.getElementById('customerSearch');
  const refreshCustomers = document.getElementById('refreshCustomers');

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
    await Promise.all([loadStats(), loadCustomers(), loadLookups(), loadCache()]);
  }

  async function loadStats() {
    const data = await api('/api/admin/stats');
    const items = [
      ['Total lookups', data.totalLookups],
      ['Unique VRMs', data.uniqueVrms],
      ['Cache hit rate', data.cacheHitRate + '%'],
      ['Customers with credits', data.customersWithCredits],
      ['Cached registrations', data.cachedRegistrations],
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

  async function loadCustomers() {
    const q = customerSearch.value.trim();
    const qs = q ? '?search=' + encodeURIComponent(q) : '';
    const data = await api('/api/admin/customers' + qs);
    customersBody.innerHTML = data.customers
      .map(function (c) {
        return (
          '<tr>' +
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
          escapeHtml(Number(c.spend_remainder || 0).toFixed(2)) +
          '</td>' +
          '<td>' +
          escapeHtml(Number(c.total_spend || 0).toFixed(2)) +
          '</td>' +
          '<td>' +
          escapeHtml(formatDateOnly(c.updated_at)) +
          '</td>' +
          '<td class="actions">' +
          '<input class="small" type="number" min="0" value="' +
          escapeHtml(String(c.credits)) +
          '" data-id="' +
          escapeHtml(c.shopify_customer_id) +
          '" />' +
          '<button type="button" data-save="' +
          escapeHtml(c.shopify_customer_id) +
          '">Save</button>' +
          '</td>' +
          '</tr>'
        );
      })
      .join('');
  }

  async function loadLookups() {
    const data = await api('/api/admin/lookups?limit=100');
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
          escapeHtml(row.company || '—') +
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
          '<td>' +
          (row.was_cached ? 'Yes' : 'No') +
          '</td>' +
          '</tr>'
        );
      })
      .join('');
  }

  async function loadCache() {
    const data = await api('/api/admin/cache?limit=50');
    cacheBody.innerHTML = data.cache
      .map(function (row) {
        return (
          '<tr>' +
          '<td>' +
          escapeHtml(row.vrm) +
          '</td>' +
          '<td>' +
          escapeHtml(formatDateOnly(row.fetched_at)) +
          '</td>' +
          '<td>' +
          escapeHtml(String(row.age_days)) +
          '</td>' +
          '<td><button type="button" class="secondary" data-purge="' +
          escapeHtml(row.vrm) +
          '">Purge</button></td>' +
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
    await withButtonLoading(btn, async function () {
      await api('/api/admin/customers', {
        method: 'POST',
        body: JSON.stringify({
          customer_id: fd.get('customer_id'),
          email: fd.get('email') || undefined,
          credits: Number(fd.get('credits')),
        }),
      });
      creditForm.reset();
      await Promise.all([loadCustomers(), loadStats()]);
    });
  });

  refreshCustomers.addEventListener('click', async function () {
    await withButtonLoading(refreshCustomers, loadCustomers);
  });

  customerSearch.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') {
      withButtonLoading(refreshCustomers, loadCustomers);
    }
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

  cacheBody.addEventListener('click', async function (e) {
    const btn = e.target.closest('[data-purge]');
    if (!btn) return;
    const vrm = btn.getAttribute('data-purge');
    await withButtonLoading(btn, async function () {
      await api('/api/admin/cache/' + encodeURIComponent(vrm), { method: 'DELETE' });
      await Promise.all([loadCache(), loadStats()]);
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
    lookupModalTitle.textContent = 'VRM ' + (v.vrm || row.vrm);
    const fields = [
      ['Name', row.name],
      ['Email', row.email],
      ['Company', row.company],
      ['Registration', v.vrm],
      ['VIN', v.vin || v.vinLast5],
      ['Make', v.make],
      ['Model', v.model],
      ['Year', v.year],
      ['Fuel Type', v.fuel],
      ['Colour', v.colour],
      ['Engine Capacity', v.engineCc],
      ['Date First Registered', v.dateFirstRegistered],
      ['Tax Status', v.taxStatus],
      ['Tax Due Date', v.taxDueDate],
      ['Cached lookup', row.was_cached ? 'Yes' : 'No'],
    ];
    lookupModalBody.innerHTML =
      '<dl class="modal-dl">' +
      fields
        .map(function (pair) {
          return (
            '<dt>' +
            escapeHtml(String(pair[0])) +
            '</dt><dd>' +
            escapeHtml(pair[1] == null || pair[1] === '' ? '—' : String(pair[1])) +
            '</dd>'
          );
        })
        .join('') +
      '</dl>';
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
