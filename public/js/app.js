// Tunnel Server Dashboard - Client Side
document.addEventListener('DOMContentLoaded', () => {
  // Auto-refresh dashboard stats
  const statEls = {
    totalUsers: document.getElementById('stat-total-users'),
    activeUsers: document.getElementById('stat-active-users'),
    enabledUsers: document.getElementById('stat-enabled-users'),
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
});
