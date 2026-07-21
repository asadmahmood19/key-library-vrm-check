(function () {
  const params = new URLSearchParams(window.location.search);
  const customerId = params.get('customer_id') || '';
  const email = params.get('email') || '';

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

  function show(el) {
    el.classList.remove('hidden');
  }

  function hide(el) {
    el.classList.add('hidden');
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

  function renderHistory(items) {
    if (!items || !items.length) {
      hide(historyPanel);
      return;
    }
    historyList.innerHTML = items
      .map(function (item) {
        const when = new Date(item.created_at).toLocaleString();
        const tag = item.was_cached ? 'cached' : 'live';
        return (
          '<li><span><strong>' +
          escapeHtml(item.vrm) +
          '</strong> · ' +
          tag +
          '</span><span>' +
          escapeHtml(when) +
          '</span></li>'
        );
      })
      .join('');
    show(historyPanel);
  }

  function renderResult(data) {
    const v = data.vehicle;
    const fields = [
      ['Registration', v.vrm],
      ['Make', v.make],
      ['Model', v.model],
      ['Year', v.year],
      ['Colour', v.colour],
      ['Fuel', v.fuel],
      ['Engine (cc)', v.engineCc],
      ['Body', v.body],
      ['Transmission', v.transmission],
      ['VIN (last 5)', v.vinLast5],
    ];
    resultPanel.innerHTML =
      '<h2>Vehicle details</h2><dl>' +
      fields
        .map(function (pair) {
          return (
            '<dt>' +
            escapeHtml(String(pair[0])) +
            '</dt><dd>' +
            escapeHtml(pair[1] == null ? '—' : String(pair[1])) +
            '</dd>'
          );
        })
        .join('') +
      '</dl>' +
      (data.fromCache
        ? '<span class="cache-badge">Served from cache (no credit used)</span>'
        : '');
    show(resultPanel);
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
      errorMsg.textContent =
        'Missing customer_id. Embed this page with ?customer_id={{ customer.id }} from Shopify.';
      show(errorMsg);
      return;
    }

    const qs = new URLSearchParams({ customer_id: customerId });
    if (email) qs.set('email', email);
    const res = await fetch('/api/credits?' + qs.toString());
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to load credits');
    buyCreditsUrl = data.buyCreditsUrl || buyCreditsUrl;
    setCredits(data.credits);
    renderHistory(data.history);
  }

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
          customer_id: customerId,
          email: email || undefined,
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
})();
