declare module "vanta/dist/vanta.net.min" {
  const VANTA: (opts: Record<string, unknown>) => { destroy: () => void };
  export default VANTA;
}
