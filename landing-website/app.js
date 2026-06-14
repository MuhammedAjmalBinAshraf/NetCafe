document.addEventListener('DOMContentLoaded', () => {
  // 1. Navbar scroll effect
  const navbar = document.getElementById('navbar');
  window.addEventListener('scroll', () => {
    if (window.scrollY > 50) {
      navbar.classList.add('scrolled');
    } else {
      navbar.classList.remove('scrolled');
    }
  });

  // 2. Setup Guide Tab Switcher
  const tabServerBtn = document.getElementById('tab-server-btn');
  const tabAgentBtn = document.getElementById('tab-agent-btn');
  const guideServer = document.getElementById('guide-server');
  const guideAgent = document.getElementById('guide-agent');

  tabServerBtn.addEventListener('click', () => {
    tabServerBtn.classList.add('active');
    tabAgentBtn.classList.remove('active');
    guideServer.classList.add('active');
    guideAgent.classList.remove('active');
  });

  tabAgentBtn.addEventListener('click', () => {
    tabAgentBtn.classList.add('active');
    tabServerBtn.classList.remove('active');
    guideAgent.classList.add('active');
    guideServer.classList.remove('active');
  });

  // 3. FAQ Accordion
  const faqQuestions = document.querySelectorAll('.faq-question');

  faqQuestions.forEach(question => {
    question.addEventListener('click', () => {
      const item = question.parentElement;
      const answer = question.nextElementSibling;
      const isActive = item.classList.contains('active');

      // Close all open items first for single accordion behavior
      document.querySelectorAll('.faq-item').forEach(el => {
        el.classList.remove('active');
        el.querySelector('.faq-answer').style.maxHeight = null;
      });

      if (!isActive) {
        item.classList.add('active');
        answer.style.maxHeight = answer.scrollHeight + 'px';
      }
    });
  });

  // 4. Fetch latest release version from GitHub API
  const versionBadge = document.getElementById('version-badge');
  if (versionBadge) {
    fetch('https://api.github.com/repos/MuhammedAjmalBinAshraf/NetCafe/releases/latest')
      .then(response => response.json())
      .then(data => {
        if (data && data.tag_name) {
          versionBadge.textContent = data.tag_name + ' Stable Release';
        } else {
          versionBadge.textContent = 'V1.0 Stable Release';
        }
      })
      .catch(err => {
        console.error('Error fetching latest release:', err);
        versionBadge.textContent = 'V1.0 Stable Release';
      });
  }
});
