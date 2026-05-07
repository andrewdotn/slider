import React from "react";

export function Font({ size }: { size: string }) {
  // Accept "70%" or "0.7"; emit a unitless multiplier so `calc(18px * x)`
  // works in style.css. (Length × percentage isn't valid in CSS calc.)
  const scale = size.trim().endsWith("%")
    ? String(parseFloat(size) / 100)
    : size;
  return (
    <style>{`.slides article.current { --font-scale: ${scale}; }`}</style>
  );
}
