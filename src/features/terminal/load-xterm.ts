export async function loadXterm() {
  const [{ Terminal }, { FitAddon }, { ImageAddon }] = await Promise.all([
    import("@xterm/xterm"),
    import("@xterm/addon-fit"),
    import("@xterm/addon-image"),
    import("@xterm/xterm/css/xterm.css"),
  ]);

  return { Terminal, FitAddon, ImageAddon };
}
