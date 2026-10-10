/* ----------------------------------------------------------------------
 Static XSPICE code-model registry for the WebAssembly build.

 Native ngspice dlopen()s each code-model library (digital.cm, analog.cm,
 ...) and reads its device / UDN tables through dlmain.c. Emscripten cannot
 dlopen a plain static module, so the code-model objects are linked into
 spice.wasm instead and this file stands in for dlmain.c:

   - it builds each library's device and UDN tables from the cmpp-generated
     <lib>/cminfo.h and <lib>/udninfo.h, and
   - cmstatic_load() registers a library's tables when ngspice runs
     "codemodel <path>/<lib>.cm" (load_opus is patched to ask it first).

 Code models call the cm_* API directly, resolved against ngspice's own
 implementations, so no coreitf indirection is needed. The few functions
 that exist only in dlmain.c (not in ngspice's core) are reproduced below.

 Compile from the build tree's src/xspice/icm directory (after cmpp has
 generated the per-library headers) with -I. and the ngspice include dirs.
------------------------------------------------------------------------ */

#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "ngspice/ngspice.h"
#include "ngspice/cpextern.h"
#include "ngspice/devdefs.h"
#include "ngspice/dstring.h"
#include "ngspice/dllitf.h"
#include "ngspice/evtudn.h"
#include "ngspice/inpdefs.h"
#include "ngspice/inertial.h"
#include "ngspice/cmproto.h"

extern int add_device(int n, SPICEdev **devs, int flag);
extern int add_udn(int n, Evt_Udn_Info_t **udns);
int cmstatic_load(const char *path);

#include "spice2poly/cmextrn.h"
#include "spice2poly/udnextrn.h"
#include "digital/cmextrn.h"
#include "digital/udnextrn.h"
#include "analog/cmextrn.h"
#include "analog/udnextrn.h"
#include "xtradev/cmextrn.h"
#include "xtradev/udnextrn.h"
#include "xtraevt/cmextrn.h"
#include "xtraevt/udnextrn.h"
#include "table/cmextrn.h"
#include "table/udnextrn.h"
#include "tlines/cmextrn.h"
#include "tlines/udnextrn.h"

static SPICEdev *spice2poly_devs[] = {
#include "spice2poly/cminfo.h"
    NULL
};
static Evt_Udn_Info_t *spice2poly_udns[] = {
#include "spice2poly/udninfo.h"
    NULL
};

static SPICEdev *digital_devs[] = {
#include "digital/cminfo.h"
    NULL
};
static Evt_Udn_Info_t *digital_udns[] = {
#include "digital/udninfo.h"
    NULL
};

static SPICEdev *analog_devs[] = {
#include "analog/cminfo.h"
    NULL
};
static Evt_Udn_Info_t *analog_udns[] = {
#include "analog/udninfo.h"
    NULL
};

static SPICEdev *xtradev_devs[] = {
#include "xtradev/cminfo.h"
    NULL
};
static Evt_Udn_Info_t *xtradev_udns[] = {
#include "xtradev/udninfo.h"
    NULL
};

static SPICEdev *xtraevt_devs[] = {
#include "xtraevt/cminfo.h"
    NULL
};
static Evt_Udn_Info_t *xtraevt_udns[] = {
#include "xtraevt/udninfo.h"
    NULL
};

static SPICEdev *table_devs[] = {
#include "table/cminfo.h"
    NULL
};
static Evt_Udn_Info_t *table_udns[] = {
#include "table/udninfo.h"
    NULL
};

static SPICEdev *tlines_devs[] = {
#include "tlines/cminfo.h"
    NULL
};
static Evt_Udn_Info_t *tlines_udns[] = {
#include "tlines/udninfo.h"
    NULL
};

struct cmstatic_lib {
    const char *name;
    SPICEdev **devs;
    Evt_Udn_Info_t **udns;
    int loaded;
};

static struct cmstatic_lib cmstatic_libs[] = {
    { "spice2poly", spice2poly_devs, spice2poly_udns, 0 },
    { "digital",    digital_devs,    digital_udns,    0 },
    { "analog",     analog_devs,     analog_udns,     0 },
    { "xtradev",    xtradev_devs,    xtradev_udns,    0 },
    { "xtraevt",    xtraevt_devs,    xtraevt_udns,    0 },
    { "table",      table_devs,      table_udns,      0 },
    { "tlines",     tlines_devs,     tlines_udns,     0 },
};

/* Register the built-in library whose file name (ignoring directory and a
 * trailing ".cm") matches path. Returns 0 when it is built in (registering
 * it once only), -1 when it is not, so the caller can fall back to dlopen. */
int cmstatic_load(const char *path)
{
    const char *base = strrchr(path, '/');
    size_t len;
    size_t i;

    base = base ? base + 1 : path;
    len = strlen(base);
    if (len > 3 && strcmp(base + len - 3, ".cm") == 0)
        len -= 3;

    for (i = 0; i < sizeof cmstatic_libs / sizeof cmstatic_libs[0]; i++) {
        struct cmstatic_lib *lib = &cmstatic_libs[i];
        int ndev = 0, nudn = 0;
        if (strlen(lib->name) != len || strncmp(lib->name, base, len) != 0)
            continue;
        if (lib->loaded)
            return 0;
        while (lib->devs[ndev])
            ndev++;
        while (lib->udns[nudn])
            nudn++;
        add_device(ndev, lib->devs, 1);
        add_udn(nudn, lib->udns);
        lib->loaded = 1;
        return 0;
    }
    return -1;
}

/* ---- Functions that dlmain.c provides to code models but ngspice's core
 * does not. Bodies follow dlmain.c, calling the core directly. ---- */

bool cm_getvar(char *name, enum cp_types type, void *retval, size_t rsize)
{
    return cp_getvar(name, type, retval, rsize);
}

FILE *cm_stream_out(void) { return stdout; }
FILE *cm_stream_in(void)  { return stdin; }
FILE *cm_stream_err(void) { return stderr; }

void *malloc_pj(size_t s) { return tmalloc(s); }
void *calloc_pj(size_t s1, size_t s2) { return tmalloc(s1 * s2); }
void *realloc_pj(const void *ptr, size_t s) { return trealloc(ptr, s); }
void free_pj(const void *ptr) { txfree(ptr); }

int cm_message_printf(const char *fmt, ...)
{
    char buf[1024];
    char *p = buf;
    int size = sizeof(buf);
    int rv;

    for (;;) {
        int nchars;
        va_list ap;

        va_start(ap, fmt);
        nchars = vsnprintf(p, (size_t) size, fmt, ap);
        va_end(ap);

        if (nchars == -1) {
            size *= 2;
        } else if (size < nchars + 1) {
            size = nchars + 1;
        } else {
            break;
        }

        if (p == buf)
            p = tmalloc((size_t) size * sizeof(char));
        else
            p = trealloc(p, (size_t) size * sizeof(char));
    }

    rv = cm_message_send(p);
    if (p != buf)
        txfree(p);
    return rv;
}

/* Open <path> for d_state, file_source, d_source: relative to the netlist's
 * directory (cm_get_path), then NGSPICE_INPUT_DIR, then as given. */
#define DFLT_BUF_SIZE 256
FILE *fopen_with_path(const char *path, const char *mode)
{
    FILE *fp;

    if ((path[0] != '/') && (path[1] != ':')) {
        const char *x = cm_get_path();
        if (x) {
            DS_CREATE(ds, DFLT_BUF_SIZE);

            if (ds_cat_printf(&ds, "%s/%s", x, path) != 0) {
                cm_message_printf(
                        "Unable to build cm_get_path() path for opening file.");
                ds_free(&ds);
                return (FILE *) NULL;
            }

            if ((fp = fopen(ds_get_buf(&ds), mode)) == (FILE *) NULL) {
                char *y = getenv("NGSPICE_INPUT_DIR");
                if (y && *y) {
                    int rc_ds = 0;
                    size_t len;
                    ds_clear(&ds);
                    rc_ds |= ds_cat_str(&ds, y);
                    len = ds_get_length(&ds);
                    if (len > 0 && ds_get_buf(&ds)[len - 1] != '/') {
                        rc_ds |= ds_cat_char(&ds, '/');
                    }
                    rc_ds |= ds_cat_str(&ds, path);
                    if (rc_ds != 0) {
                        cm_message_printf(
                                "Unable to build NGSPICE_INPUT_DIR "
                                "path for opening file.");
                        ds_free(&ds);
                        return (FILE *) NULL;
                    }
                    if ((fp = fopen(ds_get_buf(&ds), mode)) != (FILE *) NULL) {
                        ds_free(&ds);
                        return fp;
                    }
                }
            }
            else {
                ds_free(&ds);
                return fp;
            }
            ds_free(&ds);
        }
    }

    fp = fopen(path, mode);
    return fp;
}

/* Function used for inertial delay in digital logic models. */
Mif_Boolean_t cm_is_inertial(enum param_vals param)
{
    int cvar;

    if (cm_getvar("digital_delay_type", CP_NUM, &cvar, sizeof cvar)) {
        if (cvar >= OVERRIDE_TRANSPORT) {
            /* Parameter override. */
            return cvar > OVERRIDE_TRANSPORT;
        }
        if (param == Not_set) // Not specified
            return cvar != DEFAULT_TRANSPORT;
        return param != Off;
    }
    return param == On;
}
