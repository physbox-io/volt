/**
 * Read output from spice
 */

export type VariableType = {
  name: string;
  type: "voltage" | "current" | "time" | "frequency" | "notype";
};

export type RealDataType = {
  name: string;
  type: VariableType["type"];
  values: RealNumber[];
};

export type ComplexDataType = {
  name: string;
  type: VariableType["type"];
  values: ComplexNumber[];
};

export type ResultType =
  | {
    header: string;
    numVariables: number;
    variableNames: string[];
    numPoints: number;
    dataType: "real";
    data: RealDataType[];
  }
  | {
    header: string;
    numVariables: number;
    variableNames: string[];
    numPoints: number;
    dataType: "complex";
    data: ComplexDataType[];
  };

type RawResultType = {
  param: ParamType;
  header: string;
  data: RealNumber[][] | ComplexNumber[][];
};

type ParamType = {
  varNum: number;
  pointNum: number;
  variables: VariableType[];
  dataType: "real" | "complex";
};

export type RealNumber = number;
export type ComplexNumber = { real: number; img: number };

export function readRawOutput(rawData: Uint8Array): RawResultType {
  //

  const resultStr = ab2str(rawData);

  const offset = resultStr.indexOf("Binary:");
  log(`file-> ${offset}`);
  const header = resultStr.substring(0, offset) + "\n";

  const param = findParams(header);
  log(header);
  log(param);

  const binaryByteOffset = offset + 8;
  const expectedFloats = param.varNum * param.pointNum * (param.dataType === "complex" ? 2 : 1);
  const expectedBytes = expectedFloats * 8;

  // Slice out the exact binary portion
  const binaryBytes = rawData.subarray(binaryByteOffset, binaryByteOffset + expectedBytes);

  // Copy to an aligned buffer to avoid start offset alignment errors for Float64Array
  const alignedBuffer = new ArrayBuffer(expectedBytes);
  new Uint8Array(alignedBuffer).set(binaryBytes);
  const out = new Float64Array(alignedBuffer);

  log("🤔", out);

  if (param.dataType === "complex") {
    const out2: ComplexNumber[][] = [];
    for (let v = 0; v < param.varNum; v++) {
      out2.push(new Array(param.pointNum));
    }

    for (let p = 0; p < param.pointNum; p++) {
      const base = p * param.varNum * 2;
      for (let v = 0; v < param.varNum; v++) {
        const offset = base + v * 2;
        out2[v][p] = {
          real: out[offset],
          img: out[offset + 1]
        };
      }
    }
    log(out2);

    const rawResult: RawResultType = {
      param: param,
      header: header,
      data: out2,
    };
    return rawResult;
  } else {
    // Real
    const out2: RealNumber[][] = [];
    for (let v = 0; v < param.varNum; v++) {
      out2.push(new Array(param.pointNum));
    }

    for (let p = 0; p < param.pointNum; p++) {
      const base = p * param.varNum;
      for (let v = 0; v < param.varNum; v++) {
        out2[v][p] = out[base + v];
      }
    }
    //log(out2);

    const rawResult: RawResultType = {
      param: param,
      header: header,
      data: out2,
    };
    return rawResult;
  }
}

function ab2str(buf: Uint8Array) {
  return new TextDecoder("utf-8").decode(buf);
}

function findParams(header: string): ParamType {
  //

  const lines = header.split("\n");

  log("header in findParam->", lines);

  const varNum = parseInt(
    lines[lines.findIndex((s) => s.startsWith("No. Variables"))].split(":")[1],
    10
  );
  const pointNum = parseInt(
    lines[lines.findIndex((s) => s.startsWith("No. Points"))].split(":")[1],
    10
  );
  const dataType =
    lines[lines.findIndex((s) => s.startsWith("Flags"))]
      .split(":")[1]
      .indexOf("complex") > -1
      ? "complex"
      : "real";

  //log("🤔", lines);
  //log(lines.indexOf("Variables:"));

  const varList: VariableType[] = [] as VariableType[];
  for (let i = 0; i < varNum; i++) {
    const str = lines[i + lines.indexOf("Variables:") + 1];
    const str2 = str.split(/\s+/).filter((s) => s.length > 0); // Filter out empty strings
    log("str2->", str2);
    varList.push({
      name: str2[1], // Variable name is the 2nd non-empty column
      type: str2[2] as VariableType["type"], // Variable type is the 3rd non-empty column
    });
  }
  //log("varlist->", varList);

  const param: ParamType = {
    varNum: varNum,
    pointNum: pointNum,
    variables: [...varList],
    dataType: dataType,
  };

  log("param->", param);

  return param;
}

export function readOutput(output: Uint8Array): ResultType {
  const rawResult = readRawOutput(output);
  const param = rawResult.param;
  const header = rawResult.header;
  const data = rawResult.data;

  if (param.dataType === "complex") {
    // Filter to only include voltage, current, and time and frequency variables
    const filteredData = (data as ComplexNumber[][])
      .map((values, i) => ({
        name: param.variables[i].name,
        type: param.variables[i].type,
        values: values,
        index: i,
      }))
      .filter((item) => item.type !== "notype");

    return {
      header: header,
      numVariables: filteredData.length,
      variableNames: filteredData.map((e) => e.name),
      numPoints: param.pointNum,
      dataType: "complex",
      data: filteredData.map((e) => ({
        name: e.name,
        type: e.type,
        values: e.values,
      })),
    };
  } else {
    // Filter to only include voltage, current, and time and frequency variables
    const filteredData = (data as number[][])
      .map((values, i) => ({
        name: param.variables[i].name,
        type: param.variables[i].type,
        values: values,
        index: i,
      }))
      .filter((item) => item.type !== "notype");

    return {
      header: header,
      numVariables: filteredData.length,
      variableNames: filteredData.map((e) => e.name),
      numPoints: param.pointNum,
      dataType: "real",
      data: filteredData.map((e) => ({
        name: e.name,
        type: e.type,
        values: e.values,
      })),
    };
  }
}

function log(message?: unknown, ...optionalParams: unknown[]) {
  const isDebug = false;
  if (isDebug) console.log(message, optionalParams);
}
