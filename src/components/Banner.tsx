// ============================================================
// Eris — Banner de Bienvenida
// ============================================================

import React from "react";
import { Box, Text } from "ink";

const ERIS_LOGO = `
  ███████╗██████╗ ██╗███████╗
  ██╔════╝██╔══██╗██║██╔════╝
  █████╗  ██████╔╝██║███████╗
  ██╔══╝  ██╔══██╗██║╚════██║
  ███████╗██║  ██║██║███████║
  ╚══════╝╚═╝  ╚═╝╚═╝╚══════╝`;

export function Banner(): React.ReactElement {
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text color="magenta" bold>
        {ERIS_LOGO}
      </Text>
      <Box marginTop={0} marginLeft={2}>
        <Text color="gray">{"  "}La Diosa del Caos</Text>
        <Text color="gray">{" · "}</Text>
        <Text color="magentaBright">v0.1.0</Text>
      </Box>
      <Box marginLeft={2} marginTop={0}>
        <Text color="gray" dimColor>
          {"  "}Escribe tu mensaje o usa /help para comandos
        </Text>
      </Box>
      <Box marginLeft={2}>
        <Text color="gray" dimColor>
          {"  "}─────────────────────────────────────────
        </Text>
      </Box>
    </Box>
  );
}
