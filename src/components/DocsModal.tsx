import { useState } from 'react';
import { X } from 'lucide-react';

interface DocsModalProps {
  onClose: () => void;
}

const LICENSE_TEXT = `Circuit Expt is licensed under the MIT license. It's heavily built on ngspice, which has the following modified BSD license:

Copyright 1985 - 2018, Regents of the University of California and others

Redistribution and use in source and binary forms, with or without modification,
are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice,
this list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice,
this list of conditions and the following disclaimer in the documentation
and/or other materials provided with the distribution.

3. Neither the name of the copyright holder nor the names of its
contributors may be used to endorse or promote products derived from this
software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE
LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
POSSIBILITY OF SUCH DAMAGE.`;

export function DocsModal({ onClose }: DocsModalProps) {
  const [activeTab, setActiveTab] = useState<'about' | 'usage' | 'simulation' | 'audio' | 'milling' | 'license'>('about');

  return (
    // Same modal layer as every other full-screen dialog. At z-[100] this tied
    // with the note card, leaving DOM order to decide which one won.
    <div className="fixed inset-0 bg-black/50 z-[99999] flex items-center justify-center p-4 animate-in fade-in duration-200">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl max-w-4xl w-full h-[80vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-200">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-800">
          <h2 className="text-xl font-bold text-slate-800 dark:text-slate-100">Documentation</h2>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 transition-colors cursor-pointer">
            <X size={24} />
          </button>
        </div>
        <div className="flex flex-1 overflow-hidden">
          <div className="w-64 bg-slate-50 dark:bg-slate-950/60 border-r border-slate-200 dark:border-slate-800 p-4 flex flex-col gap-2 overflow-y-auto">
            <button
              onClick={() => setActiveTab('about')}
              className={`text-left px-4 py-2 rounded-md font-medium transition-colors cursor-pointer ${
                activeTab === 'about'
                  ? 'bg-indigo-100 dark:bg-indigo-950/50 text-indigo-700 dark:text-indigo-400 font-semibold'
                  : 'text-slate-650 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-800'
              }`}
            >
              About
            </button>
            <button
              onClick={() => setActiveTab('simulation')}
              className={`text-left px-4 py-2 rounded-md font-medium transition-colors cursor-pointer ${
                activeTab === 'simulation'
                  ? 'bg-indigo-100 dark:bg-indigo-950/50 text-indigo-700 dark:text-indigo-400 font-semibold'
                  : 'text-slate-650 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-800'
              }`}
            >
              Simulation Engine
            </button>
            <button
              onClick={() => setActiveTab('audio')}
              className={`text-left px-4 py-2 rounded-md font-medium transition-colors cursor-pointer ${
                activeTab === 'audio'
                  ? 'bg-indigo-100 dark:bg-indigo-950/50 text-indigo-700 dark:text-indigo-400 font-semibold'
                  : 'text-slate-650 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-800'
              }`}
            >
              Audio
            </button>
            <button
              onClick={() => setActiveTab('usage')}
              className={`text-left px-4 py-2 rounded-md font-medium transition-colors cursor-pointer ${
                activeTab === 'usage'
                  ? 'bg-indigo-100 dark:bg-indigo-950/50 text-indigo-700 dark:text-indigo-400 font-semibold'
                  : 'text-slate-650 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-800'
              }`}
            >
              Usage Guide
            </button>
            <button
              onClick={() => setActiveTab('milling')}
              className={`text-left px-4 py-2 rounded-md font-medium transition-colors cursor-pointer ${
                activeTab === 'milling'
                  ? 'bg-indigo-100 dark:bg-indigo-950/50 text-indigo-700 dark:text-indigo-400 font-semibold'
                  : 'text-slate-650 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-800'
              }`}
            >
              PCB Milling
            </button>
            <button
              onClick={() => setActiveTab('license')}
              className={`text-left px-4 py-2 rounded-md font-medium transition-colors cursor-pointer ${
                activeTab === 'license'
                  ? 'bg-indigo-100 dark:bg-indigo-950/50 text-indigo-700 dark:text-indigo-400 font-semibold'
                  : 'text-slate-655 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-800'
              }`}
            >
              License
            </button>
          </div>
          <div className="flex-1 p-8 overflow-y-auto bg-white dark:bg-slate-900 transition-colors">
            {activeTab === 'about' && (
              <div className="prose dark:prose-invert max-w-none text-slate-800 dark:text-slate-200 leading-relaxed">
                <h3 className="text-2xl font-bold mb-4">About Circuit Expt</h3>
                <p className="mb-4">
                  Circuit Expt is an interactive, browser-based electronics playground and simulation tool. 
                  It allows users to design, test, and learn about electronic circuits in real-time through a 
                  visual drag-and-drop interface.
                </p>
                <p className="mb-4">
                  Powered by the robust ngspice engine (via WebAssembly), the simulator can perform 
                  transient analysis on complex circuits involving passive components, transistors, logic 
                  gates, and even scriptable microcontrollers.
                </p>
                <p>
                  Features include:
                </p>
                <ul className="list-disc pl-6 mb-4 space-y-1">
                  <li>Real-time schematic capture and simulation</li>
                  <li>Virtual test equipment like multimeters and oscilloscopes</li>
                  <li>Dynamic, animated components (e.g. glowing LEDs)</li>
                  <li>Scriptable microcontroller nodes for mixed-signal simulation</li>
                </ul>
              </div>
            )}
            {activeTab === 'usage' && (
              <div className="prose dark:prose-invert max-w-none text-slate-800 dark:text-slate-200 leading-relaxed">
                <h3 className="text-2xl font-bold mb-4">Using the Playground</h3>
                
                <h4 className="text-xl font-semibold mb-2 mt-6">Basic Interaction</h4>
                <ul className="list-disc pl-6 mb-4 space-y-1">
                  <li><strong>Add Components:</strong> Drag components from the left sidebar onto the canvas.</li>
                  <li><strong>Wiring:</strong> Click and drag from any circular port (handle) to another to create a connection. Handles are bidirectional.</li>
                  <li><strong>Custom Wire Routing:</strong> Grab and drag a wire directly from anywhere to create a custom orthogonal bend. Double-click the wire to reset it to default routing.</li>
                  <li><strong>Select & Edit:</strong> Click a component to select it and view its properties in the right panel. You can change labels, frequencies, voltages, and more.</li>
                  <li><strong>Multi-Select:</strong> Hold <strong>Shift</strong> and drag a box over multiple components to select them together.</li>
                  <li><strong>Delete:</strong> Press the <strong>Delete</strong> or <strong>Backspace</strong> key, or use the trash icon in the header, to remove selected items.</li>
                </ul>

                <h4 className="text-xl font-semibold mb-2 mt-6">Simulation Controls</h4>
                <ul className="list-disc pl-6 mb-4 space-y-1">
                  <li><strong>Simulate:</strong> Click the green <strong>Play</strong> button to run the simulation batch. The simulation will loop automatically.</li>
                  <li><strong>Stop:</strong> Click the red <strong>Stop</strong> button to end the simulation and reset animations/audio.</li>
                  <li><strong>Duration:</strong> Set how many seconds of "circuit time" to model. Note that long durations with high-frequency signals can be slow.</li>
                  <li><strong>Resolution:</strong> Use <em>Normal</em> for logic/LEDs (faster) and <em>High</em> for audio or fast oscillators (more accurate).</li>
                </ul>

                <h4 className="text-xl font-semibold mb-2 mt-6">Tips & Tricks</h4>
                <ul className="list-disc pl-6 mb-4 space-y-1">
                  <li><strong>Grounding:</strong> Every circuit needs at least one <strong>Ground</strong> node to serve as a 0V reference.</li>
                  <li><strong>Oscilloscope:</strong> Connect the probe channels (CH1/CH2) to different parts of your circuit to compare waveforms.</li>
                  <li><strong>Interactive LEDs:</strong> LEDs will glow based on the current flowing through them. If they turn into a 💥, they've exceeded their current limit!</li>
                </ul>
              </div>
            )}
            {activeTab === 'simulation' && (
              <div className="prose dark:prose-invert max-w-none text-slate-800 dark:text-slate-200 leading-relaxed">
                <h3 className="text-2xl font-bold mb-4">How Simulation Works</h3>
                <p className="mb-4">
                  Circuit Expt utilizes a hybrid simulation approach to seamlessly blend continuous analog components with discrete digital logic and scriptable microcontrollers. Here's how the different simulation domains operate and interact:
                </p>
                <h4 className="text-xl font-semibold mb-2 mt-6">Analog Simulation (SPICE)</h4>
                <p className="mb-4">
                  At the core is <strong>ngspice</strong>, an industry-standard open-source SPICE simulator running directly in your browser via WebAssembly. It solves the complex differential equations required to model continuous-time analog components like resistors, capacitors, inductors, diodes, and transistors with high accuracy.
                </p>
                <h4 className="text-xl font-semibold mb-2 mt-6">Digital Logic (B-Sources)</h4>
                <p className="mb-4">
                  Digital logic gates (AND, OR, NOT, etc.) are modeled using native SPICE Non-Linear Dependent Sources (B-sources) rather than external code models. This allows digital logic to natively interact with analog voltage levels. A gate reads the continuous input voltages (e.g., treating anything above 2.5V as logic HIGH) and outputs a strong 5V or 0V analog signal instantly, bridging the analog and digital worlds without complex interfacing.
                </p>
                <h4 className="text-xl font-semibold mb-2 mt-6">Microcontrollers (JavaScript)</h4>
                <p className="mb-4">
                  The MCU nodes allow you to run arbitrary JavaScript code (similar to Arduino C) in an isolated sandbox. Since ngspice cannot natively execute JS, the simulator uses a <strong>multi-pass technique</strong>:
                </p>
                <ul className="list-disc pl-6 mb-4 space-y-1">
                  <li><strong>Pass 1:</strong> The MCU's JS code is executed over the requested simulation time to record its output pin states (digital and analog waveforms).</li>
                  <li><strong>Pass 2:</strong> These recorded waveforms are injected into the SPICE netlist as Piecewise Linear (PWL) voltage sources. The full analog simulation is then run, allowing the MCU to "drive" the analog components.</li>
                </ul>
                <p className="mb-4">
                  If an MCU relies on analog inputs (like reading a voltage divider), the engine can perform additional simulation passes, feeding the SPICE outputs back into the JavaScript context to ensure both domains are fully synchronized!
                </p>
                <h4 className="text-xl font-semibold mb-2 mt-6">Duration, Resolution, and Looping</h4>
                <ul className="list-disc pl-6 mb-4 space-y-1">
                  <li><strong>Duration:</strong> Controls the total physical time the simulation models. A 1.0s simulation calculates exactly 1 second of electrical behavior.</li>
                  <li><strong>Resolution:</strong> Controls the sampling rate. <em>Normal</em> resolution samples every 1ms (1kHz), which is great for visual animations and fast performance. <em>High</em> resolution samples every 0.1ms (10kHz), which is necessary for accurate audio processing (like the Microphone and Speaker) or fast oscillators.</li>
                  <li><strong>Looping:</strong> The simulation engine runs in batches. When you click "Simulate", it calculates the circuit's behavior over the requested duration, plays back the results (including audio and animations), and then automatically loops back to the beginning to run the simulation batch again. This creates a continuous interactive experience while maintaining accurate continuous-time math.</li>
                </ul>
              </div>
            )}
            {activeTab === 'audio' && (
              <div className="prose dark:prose-invert max-w-none text-slate-800 dark:text-slate-200 leading-relaxed">
                <h3 className="text-2xl font-bold mb-4">Audio & Signal Processing</h3>
                <p className="mb-4">
                  Circuit Expt supports high-fidelity audio interaction by bridging the browser's Web Audio API with the SPICE simulation engine.
                </p>
                
                <h4 className="text-xl font-semibold mb-2 mt-6">Microphone Input</h4>
                <p className="mb-4">
                  The <strong>Microphone</strong> node captures real-time audio from your browser. This audio is decimated and injected into the simulation as a Piecewise Linear (PWL) voltage source.
                </p>
                <ul className="list-disc pl-6 mb-4 space-y-2">
                  <li><strong>Gain (amplification):</strong> Scales the raw microphone signal (-1.0 to +1.0) before it enters the circuit. A gain of 100 turns a full-scale audio signal into a ±100mV peak-to-peak signal at the node's output.</li>
                </ul>

                <h4 className="text-xl font-semibold mb-2 mt-6">Speaker Output</h4>
                <p className="mb-4">
                  The <strong>Speaker</strong> node records the voltage across its terminals during the simulation. This data is then resampled and played back through your system audio.
                </p>
                <ul className="list-disc pl-6 mb-4 space-y-2">
                  <li><strong>Scale (voltageScale):</strong> Defines the expected peak-to-peak voltage of your circuit. This value is used to divide the simulated voltage down to the ±1.0 range required by audio drivers. If your circuit outputs 5V, set this to 5.0 for maximum volume without clipping.</li>
                  <li><strong>AC Couple:</strong> When enabled, the simulator calculates the average DC offset of the recorded signal and subtracts it before playback. This is essential for listening to signals riding on a DC bias (e.g., a transistor collector output).</li>
                  <li><strong>Normalize:</strong> Automatically calculates the peak voltage across the entire simulation run and scales the audio so that the loudest point is exactly 80% volume. This overrides the manual <em>Scale</em> setting to ensure a consistent listening experience.</li>
                </ul>
              </div>
            )}
            {activeTab === 'milling' && (
              <div className="prose dark:prose-invert max-w-none text-slate-800 dark:text-slate-200 leading-relaxed">
                <h3 className="text-2xl font-bold mb-4">PCB Milling &amp; Auto-Levelling</h3>
                <p className="mb-4">
                  <strong>Export &rarr; PCB Milling</strong> turns your schematic into a single-sided copper board:
                  it places footprints, routes traces, and generates isolation, drilling, and profile toolpaths.
                  You can download the G-code and drill files for another sender, or drive a GRBL machine
                  directly from the browser over WebSerial.
                </p>

                <h4 className="text-xl font-semibold mb-2 mt-6">Why auto-levelling matters</h4>
                <p className="mb-4">
                  Isolation milling cuts only about 0.05&ndash;0.1&nbsp;mm deep &mdash; barely more than the copper
                  foil is thick. A copper-clad blank is never perfectly flat, and it does not need to be very
                  unflat to ruin a board: a 0.2&nbsp;mm bow across the work is enough that one corner cuts air
                  and leaves the traces shorted while the opposite corner ploughs through into the fibreglass.
                </p>
                <p className="mb-4">
                  Auto-levelling measures the actual shape of the board before cutting. The bit is used as an
                  electrical probe: it descends slowly at each of 16 points until it touches copper, and the
                  machine reports exactly where contact happened. Those readings become a heightmap, and every
                  cutting move is then subdivided into ~1&nbsp;mm segments whose Z is interpolated across that
                  map. The cut follows the warp of the board instead of an idealised flat plane, so isolation
                  depth stays even everywhere.
                </p>

                <h4 className="text-xl font-semibold mb-2 mt-6">Wiring the probe</h4>
                <p className="mb-4">
                  You do not need a touch plate. On copper-clad the board itself is the plate &mdash; both
                  leads clip to conductive things that are already on the machine:
                </p>
                <ul className="list-disc pl-6 mb-4 space-y-1">
                  <li><strong>One clip &rarr; the bit</strong>, on the shank above the flutes, or on the collet nut.</li>
                  <li><strong>Other clip &rarr; the copper</strong>, at an edge or corner outside the area being milled. Under a hold-down screw works well.</li>
                </ul>
                <p className="mb-4">
                  Polarity does not matter; it is just a continuity circuit that closes when the bit touches
                  copper. Do <em>not</em> clip to the spindle body or the machine frame &mdash; the path through
                  the spindle bearings is intermittent and produces false triggers.
                </p>

                <h4 className="text-xl font-semibold mb-2 mt-6">Workflow</h4>
                <ul className="list-disc pl-6 mb-4 space-y-1">
                  <li><strong>1. Fix the board down</strong> and scuff the copper with a scotch pad. Oxide and finger grease are surprisingly good insulators, and a probe that skims without triggering is the failure mode that ends badly.</li>
                  <li><strong>2. Clip both probe leads on</strong> as described above.</li>
                  <li><strong>3. Jog to the board's bottom-left corner</strong> and press <strong>Zero XY here</strong>. That corner is the origin of every coordinate in the generated G-code.</li>
                  <li><strong>4. Press <strong>Zero Z on copper</strong></strong>. The bit descends slowly, stops on contact, and sets Z0 there. This corner is also the reference the heightmap is measured against.</li>
                  <li><strong>5. Start the spindle and press <strong>Level &amp; Mill PCB</strong>.</strong> It probes the 4&times;4 mesh (a minute or two), warps the toolpaths, then streams the job.</li>
                </ul>
                <p className="mb-4">
                  The job pauses at each tool change. Swap the bit, <strong>re-zero Z on the copper</strong>
                  &mdash; a new tool is a different length, so the old Z0 no longer means anything &mdash; and
                  press <strong>Resume</strong>. The heightmap itself stays valid across tool changes, because
                  the board has not moved.
                </p>

                <h4 className="text-xl font-semibold mb-2 mt-6">Things that catch people out</h4>
                <ul className="list-disc pl-6 mb-4 space-y-1">
                  <li><strong>Probe before milling, not after.</strong> Right now the copper is one continuous sheet, so every point has continuity back to your clip. Once isolation routing has cut it into islands, most of the board is connected to nothing and probe points landing on an island will simply miss.</li>
                  <li><strong>The probe only searches 3&nbsp;mm below Z0.</strong> That covers normal FR4 bow. A badly warped offcut reports "probe did not contact the surface" and aborts rather than plunging.</li>
                  <li><strong>A reading of exactly 0.000&nbsp;mm warp is a red flag,</strong> not a flat board. It almost always means the probe circuit never closed. The panel says so when it happens.</li>
                  <li><strong>Resizing the board discards the heightmap.</strong> A map only describes the board it was probed on, and stretching it over a larger area would silently apply edge values to the new region.</li>
                  <li><strong>Dry-run the first time.</strong> Do the Zero Z step with the bit a few mm clear of the board and touch it to the copper by hand &mdash; it should stop instantly.</li>
                </ul>

                <h4 className="text-xl font-semibold mb-2 mt-6">What is not compensated</h4>
                <p className="mb-4">
                  Levelling applies to straight-line cutting moves. Arcs, canned drilling cycles, and moves
                  issued in relative (G91) mode pass through at their commanded depth. The generated toolpaths
                  contain none of these, but if you hand-edit the G-code the WebSerial panel will tell you what
                  it could not compensate.
                </p>
              </div>
            )}
            {activeTab === 'license' && (
              <div className="text-slate-800 dark:text-slate-200">
                <h3 className="text-2xl font-bold mb-4">License Information</h3>
                <pre className="whitespace-pre-wrap font-mono text-xs bg-slate-50 dark:bg-slate-950/60 p-4 rounded border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400">
                  {LICENSE_TEXT}
                </pre>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
