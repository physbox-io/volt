import { models } from './models';
/**
 * SPICE simulation
 *
 * ngspice is built as its shared-library API and driven synchronously:
 * eesim_init() once, then one eesim_command() per command of a run. Each call
 * returns when ngspice has finished, so there is no interactive command loop
 * to pause between runs and no asyncify (see Docker/eesim/eesim.c).
 */

import { strModelCMOS90 } from "./circuits.ts";
import { PDK45, PDK15 } from "./models/freepdk/freePDK.ts";
import { ptm, ptmLP, ptmHP } from "./models/ptm.ts";
import { skywaterModel } from "./models/skywater/models.ts";
import Module from "./spice.js";

import { readOutput, ResultType } from "./readOutput.ts";
import { gf180 } from "./models/gf180/gf180.ts";
import { gf180mos } from "./models/gf180/gf180mos.ts";

export class Simulation {
  private static readonly MAX_INFO_CHARS = 2_000_000;

  public __getSpiceModuleForTests(): object | null {
    return this.spiceModule;
  }

  private commandList = ["source test.cir", "destroy all", "run", "write out.raw"];
  private isNoiseMode = false;
  private dataRaw: Uint8Array = new Uint8Array();
  private results: ResultType = {} as ResultType;
  private info = "";
  private initInfo = "";
  private error: string[] = [];
  private initialized = false;

  // Keep the wasm Module alive for the lifetime of this Simulation instance.
  // This prevents per-run re-instantiation/reload when the parent app reuses the object.
  private spiceModule: Awaited<ReturnType<typeof Module>> | null = null;
  private command: ((cmd: string) => number) | null = null;

  // Ensure start() is idempotent and does not create multiple wasm instances.
  private startPromise: Promise<void> | null = null;

  // Runs are serialised: a second runSim() waits for the one before it.
  private runQueue: Promise<unknown> = Promise.resolve();

  private netList = "";

  private print = (e: string = "") => {
    this.log_debug(e);
    this.info = (this.info + e + "\n").slice(-Simulation.MAX_INFO_CHARS);
  };

  private printErr = (e: string = "") => {
    this.info = (this.info + e + "\n\n").slice(-Simulation.MAX_INFO_CHARS);
    if (
      e !== "Warning: can't find the initialization file spinit." &&
      e !== "Using SPARSE 1.3 as Direct Linear Solver" &&
      !e.includes("code models") &&
      !e.includes("Any of the following steps may fail") &&
      !e.includes("OSDI")
    ) {
      this.error.push(e);
    } else {
      this.log_debug(e);
    }
  };

  /**
   * Internal startup method that sets up the Module and initialises ngspice.
   */
  private async startInternal() {
    type ModuleOptions = Record<string, unknown> & {
      locateFile?: (path: string, prefix?: string) => string;
      wasmBinary?: Uint8Array;
    };

    const moduleOptions: ModuleOptions = {
      print: this.print,
      printErr: this.printErr,
      eesimPrint: (line: string, isErr: number) => (isErr ? this.printErr(line) : this.print(line)),
    };

    if (typeof process !== "undefined" && process.versions?.node) {
      // Use a runtime-built dynamic import so bundlers don't see node:* specifiers,
      // while still letting Node preload the wasm from disk for CLI regression tests.
      const dynamicImport = new Function(
        "specifier",
        "return import(specifier);"
      ) as <T>(specifier: string) => Promise<T>;

      const [fsModule, urlModule] = await Promise.all([
        dynamicImport<typeof import("node:fs/promises")>("node:fs/promises").catch(() => null),
        dynamicImport<typeof import("node:url")>("node:url").catch(() => null),
      ]);

      if (fsModule && urlModule) {
        const wasmUrl = new URL("./spice.wasm", import.meta.url);

        if (wasmUrl.protocol === "file:") {
          // When built for the browser, the bundler inlines the wasm with a data URL,
          // so only attempt filesystem access when running from an actual file path.
          const wasmPath = urlModule.fileURLToPath(wasmUrl);

          moduleOptions.locateFile = (path: string) =>
            path === "spice.wasm" ? wasmPath : path;
          moduleOptions.wasmBinary = await fsModule.readFile(wasmPath);
        }
      }
    }

    let module = this.spiceModule;
    if (!module) {
      module = await Module(moduleOptions as never);
      this.spiceModule = module;
    }

    // Write required files

    (module.FS as any)?.mkdir("/usr");
    (module.FS as any)?.mkdir("/usr/local");
    (module.FS as any)?.mkdir("/usr/local/lib");
    (module.FS as any)?.mkdir("/usr/local/lib/ngspice");

    // The XSPICE code models (digital, analog, ...) are linked into spice.wasm;
    // spinit's "codemodel /usr/local/lib/ngspice/<lib>.cm" registers them
    // without reading any file (see Docker/static-cm/cmstatic.c).

    // Write spinit

    (module.FS as any)?.mkdir("/usr/local/share");
    (module.FS as any)?.mkdir("/usr/local/share/ngspice");
    (module.FS as any)?.mkdir("/usr/local/share/ngspice/scripts");
    (module.FS as any)?.writeFile("/usr/local/share/ngspice/scripts/spinit", Uint8Array.from(atob(models.spinit), (c: any) => c.charCodeAt(0)));
    // Keep /spinit just in case
    (module.FS as any)?.writeFile("/spinit", Uint8Array.from(atob(models.spinit), (c: any) => c.charCodeAt(0)));


    (module.FS as any)?.writeFile("/proc/meminfo", "MemTotal: 2097152 kB\nMemFree: 2097152 kB\nMemAvailable: 2097152 kB\n");
    (module.FS as any)?.writeFile("/modelcard.FreePDK45", PDK45);
    (module.FS as any)?.writeFile("/modelcard.PDK15", PDK15);
    (module.FS as any)?.writeFile("/modelcard.ptmLP", ptmLP);
    (module.FS as any)?.writeFile("/modelcard.ptmHP", ptmHP);
    (module.FS as any)?.writeFile("/modelcard.ptm", ptm);
    (module.FS as any)?.writeFile("/modelcard.skywater", skywaterModel);
    (module.FS as any)?.writeFile("/modelcard.CMOS90", strModelCMOS90);
    // GF180: global settings include file (switches/corners).
    (module.FS as any)?.writeFile("/modelcard.GF180", gf180);

    // GF180 MOS/BJT/etc library: provides sections like `.LIB typical`.
    (module.FS as any)?.writeFile("/sm141064.ngspice", gf180mos);

    // GF180 modelcards with specific corners
    (module.FS as any)?.writeFile("/modelcard.GF180.typical", gf180 + "\n.lib sm141064.ngspice typical\n");
    (module.FS as any)?.writeFile("/modelcard.GF180.ff", gf180 + "\n.lib sm141064.ngspice ff\n");
    (module.FS as any)?.writeFile("/modelcard.GF180.ss", gf180 + "\n.lib sm141064.ngspice ss\n");
    (module.FS as any)?.writeFile("/modelcard.GF180.fs", gf180 + "\n.lib sm141064.ngspice fs\n");
    (module.FS as any)?.writeFile("/modelcard.GF180.sf", gf180 + "\n.lib sm141064.ngspice sf\n");
    (module.FS as any)?.writeFile("/modelcard.GF180.statistical", gf180 + "\n.lib sm141064.ngspice statistical\n");

    const m = module as unknown as {
      cwrap: (name: string, ret: string, args: string[]) => (...a: unknown[]) => number;
    };
    const init = m.cwrap("eesim_init", "number", []);
    this.command = m.cwrap("eesim_command", "number", ["string"]) as (cmd: string) => number;

    init();
    this.initInfo = this.info;
    this.info = "";
    this.error = [];
    this.initialized = true;
  }

  /**
   * Public start method.
   * Returns a promise that resolves when the simulation module is initialized.
   */
  public start = (): Promise<void> => {
    if (this.initialized) {
      return Promise.resolve();
    }
    if (!this.startPromise) {
      this.startPromise = this.startInternal();
    }
    return this.startPromise;
  };

  /**
   * Runs the netlist last given to setNetList and resolves with its results.
   */
  public runSim = (): Promise<ResultType> => {
    const run = async (): Promise<ResultType> => {
      // If the parent app forgot to call start(), do it once here.
      await this.start();

      // Reset logs and previous results.
      this.info = "";
      this.error = [];
      this.results = {} as ResultType;

      const FS = (this.spiceModule as unknown as { FS: { writeFile: (p: string, d: string) => void; readFile: (p: string) => Uint8Array } }).FS;
      FS.writeFile("/test.cir", this.netList);
      for (const cmd of this.commandList) {
        this.log_debug(`cmd -> ${cmd}`);
        this.command!(cmd);
      }

      try {
        this.dataRaw = FS.readFile("out.raw") ?? new Uint8Array();
        this.results = readOutput(this.dataRaw);
      } catch (e) {
        this.log_debug(e);
      }
      return this.results;
    };

    const next = this.runQueue.then(run, run);
    this.runQueue = next.catch(() => undefined);
    return next;
  };

  public setNetList = (input: string): void => {
    this.netList = input;

    const hasNoiseAnalysis = /^\s*\.noise\b/im.test(input);
    if (hasNoiseAnalysis) {
      // For noise analysis, export the integrated noise plot (noise1) instead of the
      // spectral density plot (noise2), which tends to cause confusing output for users.
      this.commandList = ["source test.cir", "destroy all", "run", "setplot noise1", "write out.raw"];
      this.isNoiseMode = true;
      return;
    }

    // Reset to default command list when not running a .noise analysis.
    this.isNoiseMode = false;
    this.commandList = ["source test.cir", "destroy all", "run", "write out.raw"];
  };

  public getInfo = (): string => {
    return this.info;
  };

  public getInitInfo = (): string => {
    return this.initInfo;
  };

  public getError = (): string[] => {
    return this.error;
  };

  public isInitialized = (): boolean => {
    return this.initialized;
  };

  private log_debug = (message?: unknown, ...optionalParams: unknown[]) => {
    const isDebug = false;
    if (isDebug) console.log("simLink-> ", message, optionalParams);
  };
}
