function applyTypography() {
    function smarten(a) {
        // thanks to https://gist.github.com/drdrang/705071
        a = a.replace(/(^|[-\u2014/(\[{"\s])'/g, "$1\u2018");      // opening singles
        a = a.replace(/'/g, "\u2019");                             // closing singles & apostrophes
        a = a.replace(/(^|[-\u2014/(\[{\u2018\s])"/g, "$1\u201c"); // opening doubles
        a = a.replace(/"/g, "\u201d");                             // closing doubles
        return a;
    };
    function fixQuotes(x) {
        for (let y of x.childNodes) {
            if (y.nodeType == Node.TEXT_NODE) {
                y.textContent = smarten(y.textContent);
            } else if (y.nodeType == Node.ELEMENT_NODE){
                fixQuotes(y);
            }
        }
    }
    function fixLinks(x) {
        if (!x.id) return;
        let a = document.createElement("a");
        a.href = `#${x.id}`;
        x.classList.add("headerLink");
        x.appendChild(a);
    }
    Array.from(document.querySelectorAll("p")).forEach(fixQuotes);
    Array.from(document.querySelectorAll("blockquote")).forEach(fixQuotes);
    for (let i = 1; i < 7; i++) { Array.from(document.querySelectorAll(`h${i}`)).forEach(fixQuotes); }
    for (let i = 2; i < 7; i++) { Array.from(document.querySelectorAll(`h${i}`)).forEach(fixLinks); }
}

window.addEventListener("load", applyTypography);
