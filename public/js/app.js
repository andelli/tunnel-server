// Tunnel Server Dashboard - Client Side

document.addEventListener('DOMContentLoaded', () => {
  // Auto-refresh dashboard stats
  const statEls = {
    totalUsers: document.getElementById('stat-total-users'),
    activeUsers: document.getElementById('stat-active-users'),
    enabledUsers: document.getElementById('stat-enabled-users'),
    bandwidth: document.getElementById('stat-bandwidth'),
  };

  if (statEls.totalUsers) {
    setInterval(async () => {
      try {
        const res = await fetch('/api/stats');
        const data = await res.json();
        if (statEls.totalUsers) statEls.totalUsers.textContent = data.totalUsers;
        if (statEls.activeUsers) statEls.activeUsers.textContent = data.activeUsers;
        if (statEls.enabledUsers) statEls.enabledUsers.textContent = data.enabledUsers;
      } catch {}
    }, 10000);
  }

  // Check VPN service status
  const serviceStatus = document.getElementById('service-status');
  if (serviceStatus) {
    checkServiceStatus();
  }
});

async function checkServiceStatus() {
  const items = document.querySelectorAll('.service-item');
  for (const item of items) {
    const name = item.querySelector('span:first-child')?.textContent?.toLowerCase() || '';
    const statusEl = item.querySelector('.status-check');
    try {
      const res = await fetch(`/configs/restart/${name}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ check: true })
      });
      // Just checking if endpoint responds
      statusEl.textContent = '✅';
      statusEl.style.color = '#22c55e';
    } catch {
      statusEl.textContent = '❌';
      statusEl.style.color = '#ef4444';
    }
  }
}
