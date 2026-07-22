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

  let buyCreditsUrl = 'https://www.keylibrary.co.uk/';
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
        return (
          '<li class="history-item">' +
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
          ' title="View this lookup" aria-label="View lookup">' +
          '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">' +
          '<path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/>' +
          '<circle cx="12" cy="12" r="3"/>' +
          '</svg>' +
          '<span>View</span>' +
          '</button>' +
          '</li>'
        );
      })
      .join('');
    show(historyPanel);
    notifyHeight();
  }

  function renderResult(data, options) {
    const v = data.vehicle;
    if (!v) return;
    const opts = options || {};
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
      ['Registration Number', v.vrm],
      ['VIN', v.vin || v.vinLast5],
      ['Make', v.make],
      ['Model', v.model],
      ['Year', v.year],
    ];

    const more = [
      ['Fuel Type', v.fuel],
      ['Colour', v.colour],
      ['Engine Capacity', v.engineCc],
      ['Date First Registered', v.dateFirstRegistered],
      ['Tax Status', v.taxStatus],
      ['Tax Due Date', v.taxDueDate],
    ];

    let badge = '';
    if (opts.savedView) {
      badge = '<span class="cache-badge">Viewing saved lookup (no credit used)</span>';
    } else if (data.fromCache) {
      badge = '<span class="cache-badge">Served from cache (no credit used)</span>';
    }

    resultPanel.innerHTML =
      section('Summary', summary) + section('More Information', more) + badge;
    show(resultPanel);
    resultPanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    notifyHeight();
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
  }

  historyList.addEventListener('click', function (e) {
    const btn = e.target.closest('[data-history-index]');
    if (!btn || btn.disabled) return;
    const index = Number(btn.getAttribute('data-history-index'));
    const item = historyItems[index];
    if (!item || !item.vehicle) return;
    hide(errorMsg);
    renderResult({ vehicle: item.vehicle, fromCache: true }, { savedView: true });
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
