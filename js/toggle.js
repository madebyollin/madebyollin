// Allows user to toggle between things by clicking on them
// With special code to handle audio tags

var toggle = (() => {
    // silly redundant code that would make my teachers sad
    function hideAll(els) {
        for (var i = 0; i < els.length; i++) {
            var el = els[i];
            el.style.visibility = "hidden";
            el.style.height = "0";
            el.style.overflow = "hidden";
            el.style.position = "absolute";
            if (el.tagName == "AUDIO") {
                el.muted = true;
            }
        }
    }

    function showAll(els) {
        for (var i = 0; i < els.length; i++) {
            var el = els[i];
            el.style.visibility = "visible";
            el.style.overflow = null;
            el.style.height = null;
            el.style.position = null;
            if (el.tagName == "AUDIO") {
                el.muted = false;
            }
        }
    }

    function toggleSpectrogram(wrapper, shown) {
        console.log("toggle",wrapper,shown);
        if (!shown) {
            shown = wrapper.dataset.hidden || ".alternate";
        }

        var hidden = shown == ".alternate" ? ".standard" : ".alternate";
        hideAll(wrapper.querySelectorAll(hidden));
        showAll(wrapper.querySelectorAll(shown));
        wrapper.dataset.hidden = hidden;
    }

    function activateToggle(wrapper) {
        hideAll(wrapper.querySelectorAll(".alternate"));
        var standardToggler = wrapper.querySelector(".standard.toggler");
        var alternateToggler = wrapper.querySelector(".alternate.toggler");
        standardToggler.addEventListener("click", () => {
            toggleSpectrogram(wrapper, ".alternate");
        });
        alternateToggler.addEventListener("click", () => {
            toggleSpectrogram(wrapper, ".standard");
        });
        wrapper.addEventListener("click", (ev) => {
            if (ev.target == wrapper) {
                console.log("clicked on ", ev);
                toggleSpectrogram(wrapper);
                ev.stopPropagation();
            }
        });
        // link all audio files
        var audios = wrapper.querySelectorAll("audio");
        for (var i = 0; i < audios.length; i++) {
            var audio = audios[i];
            // they all play
            audio.addEventListener("play", ((index) => {
                for (var j = 0; j < audios.length; j++) {
                    if (j != index) {
                        audios[j].play();
                    }
                }
            }).bind(null, i));
            // they all pause
            audio.addEventListener("pause", ((index) => {
                for (var j = 0; j < audios.length; j++) {
                    if (j != index) {
                        audios[j].pause();
                    }
                }
            }).bind(null, i));
            // they all seek
            var setOthersToMatchingSeekPosition = ((au) => {
                console.log("setting others to matching seek position");
                if (!au.muted) {
                    for (var j = 0; j < audios.length; j++) {
                        if (audios[j].muted) {
                            console.log(`seeking to ${au.currentTime} for au:`);
                            console.log(`${au}`);
                            audios[j].currentTime = au.currentTime;
                        }
                    }
                }
            }).bind(null, audio);

            audio.addEventListener("seeking", setOthersToMatchingSeekPosition);
            audio.addEventListener("seeked", setOthersToMatchingSeekPosition);
        }
    }

    function init() {
        var toggles = document.querySelectorAll(".toggle");
        for (var i = 0; i < toggles.length; i++) {
            var toggle = toggles[i];
            activateToggle(toggle);
        }
    }

    return {
        init
    }
})()

toggle.init();
