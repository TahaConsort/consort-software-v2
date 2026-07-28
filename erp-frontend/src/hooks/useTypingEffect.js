import { useState, useEffect } from "react";

/**
 * Animates text appearing character-by-character.
 *
 * @param {string} text  - The full string to type out.
 * @param {number} speed - Milliseconds between each character (default: 40ms).
 * @returns {string}       The currently displayed portion of the text.
 *
 * Usage:
 *   const displayed = useTypingEffect("Hello, world!", 50);
 */
export function useTypingEffect(text, speed = 40) {
  const [displayedText, setDisplayedText] = useState("");

  useEffect(() => {
    // Reset whenever the source text changes
    setDisplayedText("");
    let i = 0;

    const interval = setInterval(() => {
      setDisplayedText(text.slice(0, i + 1));
      i++;
      if (i === text.length) clearInterval(interval);
    }, speed);

    return () => clearInterval(interval);
  }, [text, speed]);

  return displayedText;
}
