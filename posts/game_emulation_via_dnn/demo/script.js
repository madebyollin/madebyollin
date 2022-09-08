window.addEventListener("load", async () => {
    const [CHANNELS_OUT, CHANNELS_IN, HEIGHT, WIDTH] = [3, 4, 192, 256];
    const CONTROLS = {"": 3, "w": 4, "a": 5, "s": 6, "d": 7, "W" : 8, "A" : 9, "S" : 10, "D" : 11};

    // load stuff
    // ...now with graphite instead of aqua, for the refined viewer
    const networkFile = (window.location.hash == "#graphite") ? "./graphite.onnx" : "./network.onnx";
    if (window.location.hash == "#graphite") document.querySelector("#help").innerHTML += "<p style='color:steelblue'>(Graphite Edition)</p>";
    const network = await ort.InferenceSession.create(networkFile, { executionProviders: ["webgl"] });
    const memory = new ort.Tensor("float32", new Float32Array(CHANNELS_IN * HEIGHT * WIDTH), [1, CHANNELS_IN, HEIGHT, WIDTH]);
    const control = new ort.Tensor("float32", new Float32Array([CONTROLS[""]]), [1, 1, 1, 1]);

    // reset button
    document.querySelector("#c-r").onmousedown = ev => ev.target.classList.add("pressed");
    document.querySelector("#c-r").onclick = ev => {
        for (let i = 0; i < memory.data.length; i++) memory.data[i] = Math.random();
        ev.target.classList.remove("pressed");
    }
    document.querySelector("#c-r").click();

    // help button
    document.querySelector("#c-h").onclick = () => ["#c-h", "#help"].map(q=>document.querySelector(q).classList.toggle("pressed"));

    // control buttons
    for (const key of ["w", "a", "s", "d"]) {
        const el = document.querySelector(`#c-${key}`);
        el.dataset.c = CONTROLS[key];
        el.dataset.sc = CONTROLS[key.toUpperCase()];
        el.onmousedown = el.ontouchstart = () => {
            if (Date.now() - el.dataset.t < 300) el.classList.add("shift");
            el.classList.add("pressed");
            el.dataset.t = Date.now();
        };
        el.ontouchend = el.ontouchcancel = el.onmouseup = () => el.classList.remove("pressed", "shift");
    }

    // keys
    document.addEventListener("keydown", ev => {
        if (ev.key == "Escape") document.querySelector("#c-r").click();
        if (ev.key == "?") document.querySelector("#c-h").click();
        if (ev.key.toLowerCase() in CONTROLS) {
            const el = document.querySelector(`#c-${ev.key}`);
            el.classList[ev.shiftKey ? "add" : "remove"]("shift");
            el.classList.add("pressed");
            el.dataset.t = Date.now();
        };
    });

    document.addEventListener("keyup", ev => {
        if (ev.key in CONTROLS) document.querySelector(`#c-${ev.key}`).classList.remove("pressed", "shift");
    });

    // image rendering stuff
    const canvasEl = document.querySelector("canvas");
    [canvasEl.height, canvasEl.width] = [HEIGHT, WIDTH];
    const ctx = canvasEl.getContext("2d");
    const outputImage = new ImageData(new Uint8ClampedArray(HEIGHT * WIDTH * 4), WIDTH, HEIGHT);

    // main loop
    const stats = { count: 0, sum: 0 };
    function step() {
        const tick = Date.now();
        control.data[0] = [...document.querySelectorAll("#controls .pressed")].sort((a,b)=>b.dataset.t-a.dataset.t).map(c=>c.dataset[c.classList.contains("shift")?"sc":"c"])[0] || CONTROLS[""];
        network.run({Memory: memory, Control: control}).then(output => {
            output = output["Video Frame"];
            // update memory
            memory.data.set(output.data);
            // update noise (allows random guessing, attentuated when stationary)
            for (let i = output.data.length; i < memory.data.length; i++) {
                memory.data[i] = (control.data[0] == CONTROLS[""] && (Math.random() < 0.99)) ? memory.data[i] : Math.random();
            }
            // update rendering
            for (let i = 0; i < outputImage.data.length; i++) {
                outputImage.data[i] = 255 * ((i&3) == 3 || memory.data[(i&3) * HEIGHT * WIDTH + (i>>2)]);
            }
            ctx.putImageData(outputImage, 0, 0);
            // update stats
            stats.sum += Date.now() - tick;
            document.querySelector("#stats").textContent = `${Math.round((stats.sum / ++stats.count))} ms`;
        });
    }
    window.setInterval(step, 1000 / 24);
});
