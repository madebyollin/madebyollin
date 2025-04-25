// oh boy, so, line breaks. paragraphs are made out of clauses, and paragraphs also wrap along multiple lines.
// if you want the paragraph to be nice and readable, you want the line breaks and the clause breaks
// to kinda line up. you can achieve this by manually spamming [BR] tags, so this horrifying thing
// 
//     I like to eat ice cream. My
//     favorite flavor is mint chip.
//     The worst is pistachio. Tot-
//     ally inedible.
// 
// becomes this much better thing
// 
//     I like to eat ice cream. [BR]
//     My favorite flavor is mint chip. [BR]
//     The worst is pistachio. [BR]
//     Totally inedible. [BR]
// 
// but then people will read your blog post on a tiny phone and see this
// 
//     I like to eat ice cre-
//     am. [BR]
//     My favorite flavor is
//     mint chip. [BR]
//     The worst is pistach-
//     io. [BR]
//     Totally inedible. [BR]
// 
// which is worse than the original thing!!! so what do we do?
// give up and suffer? of course not.
// we spam even more [BR]s, then go in js and hide all the <br> tags
// that are making the current reading experience worse

// perplexity wrote this one btw don't blame me
function computePercentageXOffset(element) {
    // Ensure the element is valid and has a parent
    if (!element || !element.parentElement) {
        throw new Error("Invalid element or no parent element found.");
    }

    // Get the bounding rectangles of the element and its parent
    const elementRect = element.getBoundingClientRect();
    const parentRect = element.parentElement.getBoundingClientRect();

    // Calculate the x offset of the element relative to its parent
    const xOffset = elementRect.left - parentRect.left;

    // Calculate the width of the parent
    const parentWidth = parentRect.width;

    // Compute the percentage x offset
    const percentageXOffset = xOffset / parentWidth;

    return percentageXOffset;
}

const lineBreaks = document.querySelectorAll("br");
const nonBreaks = Array.from(lineBreaks).map(b=>null);

function enableLineBreak(i) {
    if (nonBreaks[i] != null) {
        nonBreaks[i].replaceWith(lineBreaks[i]);
        nonBreaks[i] = null;
    }
}

function disableLineBreak(i) {
    if (nonBreaks[i] == null) {
        let nonBreak =  document.createElement("span");
        nonBreak.classList.add("linebreak-placeholder");
        nonBreaks[i] = nonBreak;
        lineBreaks[i].replaceWith(nonBreak);
    }
}

function fixLineBreaks() {
    // disable to get everyone on the same page
    for (let i = 0; i < lineBreaks.length; i++) {
        disableLineBreak(i);
    }
    // reenable incrementally
    for (let i = 0; i < lineBreaks.length; i++) {
        // add it so that it gets placed into the document flow
        enableLineBreak(i);
        // check if it is within 20% of the end of the paragraph
        const offset = computePercentageXOffset(lineBreaks[i]);
        // if not, banish it again
        if (offset < 0.8) {
            // banish it
            disableLineBreak(i);
        }
    }
}
addEventListener("load", fixLineBreaks);
addEventListener("resize", fixLineBreaks)
