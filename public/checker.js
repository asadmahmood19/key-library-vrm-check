(function () {
  const params = new URLSearchParams(window.location.search);
  const customerId = params.get('customer_id') || '';
  const email = params.get('email') || '';
  const name = params.get('name') || '';
  const company = params.get('company') || '';

  const creditsValue = document.getElementById('creditsValue');
  const submitBtn = document.getElementById('submitBtn');
  const zeroCreditsMsg = document.getElementById('zeroCreditsMsg');
  const buyCreditsLink = document.getElementById('buyCreditsLink');
  const errorMsg = document.getElementById('errorMsg');
  const loadingMsg = document.getElementById('loadingMsg');
  const resultPanel = document.getElementById('resultPanel');
  const historyPanel = document.getElementById('historyPanel');
  const historyList = document.getElementById('historyList');
  const form = document.getElementById('lookupForm');
  const vrmInput = document.getElementById('vrmInput');
  const howItWorksBtn = document.getElementById('howItWorksBtn');
  const howItWorksModal = document.getElementById('howItWorksModal');
  const howItWorksClose = document.getElementById('howItWorksClose');

  let buyCreditsUrl = 'https://www.keylibrary.co.uk/collections/vehicle-lookup-credits';
  let credits = 0;
  let historyItems = [];

  function notifyHeight() {
    if (window.parent === window) return;
    const height = Math.ceil(
      Math.max(
        document.documentElement.scrollHeight,
        document.body.scrollHeight,
        document.documentElement.offsetHeight,
        document.body.offsetHeight
      )
    );
    window.parent.postMessage(
      { type: 'vrm-check-resize', height: height },
      '*'
    );
  }

  function show(el) {
    el.classList.remove('hidden');
    notifyHeight();
  }

  function hide(el) {
    el.classList.add('hidden');
    notifyHeight();
  }

  function setCredits(n) {
    credits = Number(n) || 0;
    creditsValue.textContent =
      credits === 1 ? '1 Credit Remaining' : credits + ' Credits Remaining';
    if (credits <= 0) {
      submitBtn.disabled = true;
      show(zeroCreditsMsg);
      buyCreditsLink.href = buyCreditsUrl;
    } else {
      submitBtn.disabled = false;
      hide(zeroCreditsMsg);
    }
  }

  function profilePayload() {
    return {
      customer_id: customerId,
      email: email || undefined,
      name: name || undefined,
      company: company || undefined,
    };
  }

  function renderHistory(items) {
    historyItems = items || [];
    if (!historyItems.length) {
      hide(historyPanel);
      return;
    }
    historyList.innerHTML = historyItems
      .map(function (item, index) {
        const canView = item.vehicle ? '' : ' disabled';
        const v = item.vehicle || {};
        const detailParts = [v.make, v.model, v.year].filter(function (part) {
          return part != null && part !== '';
        });
        const detailLine = detailParts.length
          ? '<span class="history-detail">' + detailParts.map(escapeHtml).join('<br />') + '</span>'
          : '';
        const detailsPanel = item.vehicle
          ? '<div class="history-details" id="history-details-' +
            index +
            '">' +
            '<div class="history-details-inner">' +
            '<span class="cache-badge">Viewing saved lookup (no credit used)</span>' +
            buildResultSections(item.vehicle) +
            '</div></div>'
          : '';
        return (
          '<li class="history-item">' +
          '<div class="history-row">' +
          '<div class="history-meta">' +
          '<span class="history-vrm"><strong>' +
          escapeHtml(item.vrm) +
          '</strong></span>' +
          detailLine +
          '</div>' +
          '<button type="button" class="history-view secondary" data-history-index="' +
          index +
          '"' +
          canView +
          ' aria-expanded="false"' +
          (item.vehicle
            ? ' aria-controls="history-details-' + index + '"'
            : '') +
          ' title="View this lookup" aria-label="View lookup">' +
          '<svg class="history-chevron" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
          '<path d="M6 9l6 6 6-6"/>' +
          '</svg>' +
          '<span>View</span>' +
          '</button>' +
          '</div>' +
          detailsPanel +
          '</li>'
        );
      })
      .join('');
    show(historyPanel);
    notifyHeight();
  }

  function buildResultSections(v, badgeHtml) {
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
          .map(function (row) {
            return (
              '<tr>' +
              '<td class="label">' +
              escapeHtml(row[0]) +
              '</td>' +
              '<td class="value">' +
              escapeHtml(display(row[1])) +
              '</td>' +
              '</tr>'
            );
          })
          .join('') +
        '</tbody></table></div>'
      );
    }

    const summary = [
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
    ];

    const more = [
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
    ];

    return (
      section('Summary', summary) +
      section('More Information', more) +
      (badgeHtml || '')
    );
  }

  function renderResult(data, options) {
    const v = data.vehicle;
    if (!v) return;
    const opts = options || {};

    let badge = '';
    if (opts.savedView) {
      badge = '<span class="cache-badge">Viewing saved lookup (no credit used)</span>';
    } else if (data.fromCache) {
      badge = '<span class="cache-badge">Served from cache (no credit used)</span>';
    }

    resultPanel.innerHTML = buildResultSections(v, badge);
    show(resultPanel);
    resultPanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    notifyHeight();
  }

  function closeAllHistoryDropdowns() {
    historyList.querySelectorAll('.history-item.is-open').forEach(function (el) {
      el.classList.remove('is-open');
      const btn = el.querySelector('.history-view');
      if (btn) btn.setAttribute('aria-expanded', 'false');
    });
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  async function loadCredits() {
    if (!customerId) {
      creditsValue.textContent = 'Customer not identified';
      submitBtn.disabled = true;
      errorMsg.textContent = 'Something went wrong. Please try again later.';
      show(errorMsg);
      return;
    }

    const qs = new URLSearchParams({ customer_id: customerId });
    if (email) qs.set('email', email);
    if (name) qs.set('name', name);
    if (company) qs.set('company', company);
    const res = await fetch('/api/credits?' + qs.toString());
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to load credits');
    buyCreditsUrl = data.buyCreditsUrl || buyCreditsUrl;
    setCredits(data.credits);
    renderHistory(data.history);
    const howBuy = document.getElementById('howItWorksBuyLink');
    if (howBuy) howBuy.href = buyCreditsUrl;
  }

  function openHowItWorks() {
    howItWorksModal.classList.remove('hidden');
    howItWorksClose.focus();
  }

  function closeHowItWorks() {
    if (howItWorksModal.classList.contains('hidden')) return;
    howItWorksModal.classList.add('hidden');
    howItWorksBtn.focus();
  }

  howItWorksBtn.addEventListener('click', openHowItWorks);
  howItWorksClose.addEventListener('click', closeHowItWorks);
  howItWorksModal.addEventListener('click', function (e) {
    if (e.target === howItWorksModal) closeHowItWorks();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closeHowItWorks();
  });

  historyList.addEventListener('click', function (e) {
    const btn = e.target.closest('[data-history-index]');
    if (!btn || btn.disabled) return;
    const index = Number(btn.getAttribute('data-history-index'));
    const item = historyItems[index];
    if (!item || !item.vehicle) return;
    hide(errorMsg);

    const li = btn.closest('.history-item');
    const isOpen = li.classList.contains('is-open');
    closeAllHistoryDropdowns();

    if (!isOpen) {
      li.classList.add('is-open');
      btn.setAttribute('aria-expanded', 'true');
    }
    notifyHeight();
  });

  form.addEventListener('submit', async function (e) {
    e.preventDefault();
    hide(errorMsg);
    hide(resultPanel);
    show(loadingMsg);
    submitBtn.disabled = true;

    try {
      const res = await fetch('/api/lookup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...profilePayload(),
          vrm: vrmInput.value,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Lookup failed');
      setCredits(data.creditsRemaining);
      renderResult(data);
      await loadCredits();
    } catch (err) {
      errorMsg.textContent = err.message || 'Lookup failed';
      show(errorMsg);
      setCredits(credits);
    } finally {
      hide(loadingMsg);
    }
  });

  loadCredits().catch(function (err) {
    errorMsg.textContent = err.message || 'Failed to initialise';
    show(errorMsg);
  });

  window.addEventListener('load', notifyHeight);
  window.addEventListener('resize', notifyHeight);
  if (typeof ResizeObserver !== 'undefined') {
    const ro = new ResizeObserver(function () {
      notifyHeight();
    });
    ro.observe(document.body);
  }
  setTimeout(notifyHeight, 100);
  setTimeout(notifyHeight, 500);
})();