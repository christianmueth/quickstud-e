declare module "canvas-confetti" {
  type ConfettiOptions = {
    particleCount?: number;
    spread?: number;
    origin?: {
      x?: number;
      y?: number;
    };
  };

  type ConfettiFn = (options?: ConfettiOptions) => Promise<null> | null;

  const confetti: ConfettiFn;
  export default confetti;
}