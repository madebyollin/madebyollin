// thanks to claude for this masterpiece

/**
 * Squircle Effect - Replaces border-radius with clip-path squircle effect
 * for better continuous curvature aesthetics
 */
function squirclify() {
    // Check if clip-path is supported
    if (!('clipPath' in document.documentElement.style)) {
        console.warn('clip-path is not supported in this browser. Squircle effect aborted.');
        return;
    }

    // Select all elements with .squircle class
    const squircleElements = document.querySelectorAll('.squircle');

    // Early return if no squircle elements found
    if (squircleElements.length === 0) {
        return;
    }

    // Process each squircle element
    squircleElements.forEach(element => {
        // Get computed styles
        const styles = window.getComputedStyle(element);
        const borderRadiusStr = styles.borderRadius;

        if (element.dataset.squircleBorderRadius) {
            if (borderRadiusStr != element.dataset.squircleBorderRadius) {
                // oops try again
                element.style.clipPath = null;
                element.dataset.squircleBorderRadius = null;
            } else {
                // all is right with the world
                return;
            }
        }

        // Check if borderRadius is in px
        if (!borderRadiusStr.endsWith('px')) {
            //console.error('Only pixel (px) border-radius values are supported. Element skipped:', element);
            return;
        }

        // Extract the pixel value
        // <not claude> the * 2.0 is very important to correct for later mistakes</not claude>
        const borderRadiusPx = parseFloat(borderRadiusStr) * 2.0;

        // Warn if border-radius is 0
        if (borderRadiusPx === 0) {
            //console.warn('Element with .squircle class has a border-radius of 0. Consider setting a border-radius value for better results:', element);
            return;
        }

        // Get element dimensions
        const width = element.offsetWidth;
        const height = element.offsetHeight;

        // Calculate the squircle path
        // Using a simplified continuous curvature approach with exponent
        const exponent = 4;

        // Create points for the clip path
        const generateSquirclePath = () => {
            // The number of points to use per quarter of the shape
            const pointsPerQuarter = 24;
            const points = [];

            // Generate points
            for (let i = 0; i <= pointsPerQuarter * 4; i++) {
                const angle = (i / (pointsPerQuarter * 4)) * Math.PI * 2;

                // Calculate normalized position (-1 to 1)
                const cosAngle = Math.cos(angle);
                const sinAngle = Math.sin(angle);

                // Apply the superellipse formula: |x|^n + |y|^n = 1
                const t = Math.pow(
                    Math.pow(Math.abs(cosAngle), exponent) + 
                    Math.pow(Math.abs(sinAngle), exponent),
                    1/exponent
                );

                // Calculate the radius at this angle (in pixels)
                const r = t !== 0 ? 1 / t : 0;

                // Calculate absolute positions in pixels from corners
                let x, y;

                // Determine which corner we're working from based on angle
                if (cosAngle >= 0 && sinAngle >= 0) {
                    // Top-right corner
                    x = width - Math.min(borderRadiusPx, width / 2) * (1 - r * cosAngle);
                    y = Math.min(borderRadiusPx, height / 2) * (1 - r * sinAngle);
                } else if (cosAngle < 0 && sinAngle >= 0) {
                    // Top-left corner
                    x = Math.min(borderRadiusPx, width / 2) * (1 - r * Math.abs(cosAngle));
                    y = Math.min(borderRadiusPx, height / 2) * (1 - r * sinAngle);
                } else if (cosAngle < 0 && sinAngle < 0) {
                    // Bottom-left corner
                    x = Math.min(borderRadiusPx, width / 2) * (1 - r * Math.abs(cosAngle));
                    y = height - Math.min(borderRadiusPx, height / 2) * (1 - r * Math.abs(sinAngle));
                } else {
                    // Bottom-right corner
                    x = width - Math.min(borderRadiusPx, width / 2) * (1 - r * cosAngle);
                    y = height - Math.min(borderRadiusPx, height / 2) * (1 - r * Math.abs(sinAngle));
                }

                // Convert to percentages for clip-path
                points.push(`${((x / width) * 100).toFixed(3)}% ${((y / height) * 100).toFixed(3)}%`);
            }

            return `polygon(${points.join(', ')})`;
        };

        // Apply the clip-path
        const clipPath = generateSquirclePath();
        element.style.clipPath = clipPath;
        element.dataset.squircleBorderRadius = borderRadiusStr;
    });
}

window.addEventListener("load", squirclify);
window.setInterval(squirclify, 250); // essential feature, turbo boost plz
