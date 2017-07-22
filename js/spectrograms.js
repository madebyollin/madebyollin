// make sure that spectrogram transforms follow audio
var spectrograms = (() => {
    function activateSpectrogram(wrapper) {
        var audios = wrapper.querySelectorAll("audio");
        var spectrograms = wrapper.querySelectorAll("img");
        for (var i = 0; i < audios.length; i++) {
            var audio = audios[i];
            audio.addEventListener("timeupdate", ((i) => {
                var percent = Math.round(audio.currentTime / audio.duration * 10000)/100;
                spectrograms[i].style.transform = `translateX(-${percent}%)`;
            }).bind(null, i));
        }
    }

    function init() {
        var spectrograms = document.querySelectorAll(".spectrograms");
        for (var i = 0; i < spectrograms.length; i++) {

            var spectrogram = spectrograms[i];
            activateSpectrogram(spectrogram);
        }
    }
    return {
        init
    }
})()

spectrograms.init();
