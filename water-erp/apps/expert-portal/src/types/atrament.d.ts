declare module 'atrament' {
  export const MODE_DRAW: string;
  export const MODE_ERASE: string;
  export const MODE_FILL: string;
  export const MODE_DISABLED: string;

  interface AtramentOptions {
    width?: number;
    height?: number;
    color?: string;
    weight?: number;
    smoothing?: number;
    adaptiveStroke?: boolean;
    pressureLow?: number;
    pressureHigh?: number;
    pressureSmoothing?: number;
    secondaryMouseButton?: boolean;
    ignoreModifiers?: boolean;
    recordStrokes?: boolean;
    fillWorker?: Worker;
  }

  interface Stroke {
    segments: Array<{ point: { x: number; y: number }; time: number; pressure: number }>;
    mode: string;
    weight: number;
    smoothing: number;
    color: string;
    adaptiveStroke: boolean;
  }

  export default class Atrament {
    readonly canvas: HTMLCanvasElement;
    color: string;
    weight: number;
    mode: string;
    smoothing: number;
    adaptiveStroke: boolean;
    recordStrokes: boolean;
    pressureLow: number;
    pressureHigh: number;
    pressureSmoothing: number;
    secondaryMouseButton: boolean;
    ignoreModifiers: boolean;
    readonly dirty: boolean;
    readonly currentStroke: Stroke;

    constructor(canvas: string | HTMLCanvasElement, options?: AtramentOptions);
    clear(): void;
    destroy(): void;
    beginStroke(x: number, y: number): void;
    endStroke(x: number, y: number): void;
    draw(x: number, y: number, px: number, py: number, pressure: number): { x: number; y: number };
    addEventListener(type: string, listener: (data: any) => void): void;
    removeEventListener(type: string, listener: (data: any) => void): void;
    dispatchEvent(type: string, data?: any): void;
  }
}
