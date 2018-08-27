window.addEventListener("load", () => {
    document.querySelectorAll(".youtube-video").forEach(a => {
        let watch_url = a.href;
        let parts = watch_url.split("watch?v=");
        let part = parts[parts.length - 1].split("?");
        let yt_id = part[0];
        let start_s_string = a.dataset.start ? `&start=${a.dataset.start}` : "";
        a.style.backgroundImage = `url("https://img.youtube.com/vi/${yt_id}/0.jpg")`;
        a.onclick = (e) => {
            e.preventDefault();
            a.innerHTML = `<iframe width="560" height="315" src="https://www.youtube.com/embed/${yt_id}?autoplay=1${start_s_string}" frameborder="0" allow="encrypted-media" allowfullscreen></iframe>`;
            a.classList.add("activated");
        }
    });
});
