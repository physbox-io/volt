/**
 * The emscripten module built by Docker/build-wasm.sh: ngspice's shared-library
 * API with eesim_init / eesim_command exported (Docker/eesim/eesim.c).
 */

type ModuleType = {
  FS: FSType;
  cwrap: (name: string, returnType: string | null, argTypes: string[]) => (...args: unknown[]) => unknown;
  print?: (e?: string) => void;
  printErr?: (e?: string) => void;
  /** ngspice's console output, one line per call, `isErr` for its stderr. */
  eesimPrint?: (line: string, isErr: number) => void;
};

/**
 * File System
 */
type FSType = {
  writeFile: (path: string, data: string | Uint8Array) => void;
  readFile: (path: string) => Uint8Array;
  mkdir: (path: string) => void;
};

export default function Module(m: Partial<ModuleType> & Record<string, unknown>): Promise<ModuleType>;
