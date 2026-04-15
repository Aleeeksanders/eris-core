// ============================================================
// Eris — Spinner (indicador de carga)
// ============================================================

import React, { useState, useEffect } from "react";
import { Text } from "ink";

const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

interface SpinnerProps {
  label?: string;
  color?: string;
}

export function Spinner({
  label = "Pensando...",
  color = "magenta",
}: SpinnerProps): React.ReactElement {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setFrame((prev) => (prev + 1) % frames.length);
    }, 80);
    return () => clearInterval(timer);
  }, []);

  return (
    <Text>
      <Text color={color}>{frames[frame]} </Text>
      <Text color="gray" italic>
        {label}
      </Text>
    </Text>
  );
}
