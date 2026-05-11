const mediaImages = document.querySelectorAll(".media-replaceable");

mediaImages.forEach((image) => {
  const box = image.closest(".media-box");

  const markLoaded = () => {
    if (box) {
      box.classList.add("has-media");
    }
  };

  if (image.complete && image.naturalWidth > 0) {
    markLoaded();
  } else {
    image.addEventListener("load", markLoaded, { once: true });
  }
});

const demoVideo = document.querySelector(".media-video");
const videoShell = document.querySelector(".video-shell");

if (demoVideo && videoShell) {
  const markVideoLoaded = () => {
    videoShell.classList.add("has-video");
  };

  if (demoVideo.readyState >= 1) {
    markVideoLoaded();
  } else {
    demoVideo.addEventListener("loadedmetadata", markVideoLoaded, { once: true });
  }
}

const navLinks = Array.from(document.querySelectorAll(".nav-links a"));
const sections = navLinks
  .map((link) => document.querySelector(link.getAttribute("href")))
  .filter(Boolean);

if ("IntersectionObserver" in window && sections.length > 0) {
  const observer = new IntersectionObserver(
    (entries) => {
      const visible = entries
        .filter((entry) => entry.isIntersecting)
        .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];

      if (!visible) {
        return;
      }

      navLinks.forEach((link) => {
        const isActive = link.getAttribute("href") === `#${visible.target.id}`;
        link.classList.toggle("is-active", isActive);
      });
    },
    {
      rootMargin: "-25% 0px -55% 0px",
      threshold: [0.1, 0.25, 0.5, 0.75],
    }
  );

  sections.forEach((section) => observer.observe(section));
}
