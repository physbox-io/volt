/* ----------------------------------------------------------------------
 Synchronous entry points for the WebAssembly engine.

 ngspice is built as its shared-library API (--with-ngshared) and driven
 one command at a time from JS: eesim_init() once, then eesim_command()
 for "source /test.cir", "destroy all", "run", "write out.raw". Each call
 returns when ngspice has finished the command, so the module needs no
 asyncify and no command loop paused between runs.

 ngspice's console output arrives through the SendChar callback as one line
 per call, prefixed "stdout " or "stderr "; it is handed to JS as
 Module.eesimPrint(line, isErr) with the prefix stripped.
------------------------------------------------------------------------ */

#include <emscripten.h>
#include <stdbool.h>
#include <string.h>

#include "ngspice/sharedspice.h"

EM_JS(void, eesim_print_js, (const char *s, int is_err), {
    if (Module["eesimPrint"]) Module["eesimPrint"](UTF8ToString(s), is_err);
});

static int cb_print(char *s, int id, void *user)
{
    (void) id; (void) user;
    if (strncmp(s, "stderr ", 7) == 0)
        eesim_print_js(s + 7, 1);
    else if (strncmp(s, "stdout ", 7) == 0)
        eesim_print_js(s + 7, 0);
    else
        eesim_print_js(s, 0);
    return 0;
}

/* ngspice asks to exit (e.g. "quit", or a fatal error): keep the module. */
static int cb_exit(int status, NG_BOOL immediate, NG_BOOL quit, int id, void *user)
{
    (void) immediate; (void) quit; (void) id; (void) user;
    return status;
}

static int cb_bgrunning(NG_BOOL running, int id, void *user)
{
    (void) running; (void) id; (void) user;
    return 0;
}

EMSCRIPTEN_KEEPALIVE int eesim_init(void)
{
    return ngSpice_Init(cb_print, NULL, cb_exit, NULL, NULL, cb_bgrunning, NULL);
}

EMSCRIPTEN_KEEPALIVE int eesim_command(const char *command)
{
    return ngSpice_Command((char *) command);
}
