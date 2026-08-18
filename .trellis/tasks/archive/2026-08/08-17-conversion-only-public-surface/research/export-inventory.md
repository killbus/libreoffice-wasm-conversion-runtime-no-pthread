# Export inventory evidence

## Materialized artifacts

- Conversion artifact:
  `/home/agent/Src/libreoffice-wasm-conversion-runtime/wasm/soffice.wasm`
  - bytes: `148022311`
  - SHA-256: `b24a888550d27d2942ff9c8c9a84e20cd0c852db154e8558647cb9c5294ff291`
  - WebAssembly exports: `52`
  - `lok_*` exports: `14`
- Upstream 2.7.2 artifact:
  `/home/agent/Src/libreoffice-document-converter-upstream-verify-20260817/wasm/soffice.wasm`
  - bytes: `147416331`
  - WebAssembly exports: `94`
  - `lok_*` exports: `56`

The conversion artifact removes 44 editor/render/callback/view exports and adds
`lok_convertDocument` plus `lok_convertFree`: `94 - 44 + 2 = 52`.

## Conversion artifact: exact 52 exports

```text
__cpp_exception
__cxa_decrement_exception_refcount
__cxa_increment_exception_refcount
__getTypeName
__get_exception_message
__indirect_function_table
__main_argc_argv
__thrown_object_from_unwind_exception
__trap
__wasm_call_ctors
_embind_initialize_bindings
_emscripten_check_mailbox
_emscripten_proxy_main
_emscripten_run_on_main_thread_js
_emscripten_stack_alloc
_emscripten_stack_restore
_emscripten_thread_crashed
_emscripten_thread_exit
_emscripten_thread_free_data
_emscripten_thread_init
_emscripten_tls_init
emscripten_builtin_memalign
emscripten_stack_get_base
emscripten_stack_get_current
emscripten_stack_get_end
emscripten_stack_get_free
emscripten_stack_init
emscripten_stack_set_limits
fflush
free
htonl
htons
libreofficekit_hook
libreofficekit_hook_2
lok_abortOperation
lok_convertDocument
lok_convertFree
lok_destroy
lok_documentDestroy
lok_documentLoad
lok_documentLoadWithOptions
lok_documentSaveAs
lok_getError
lok_getOperationState
lok_preinit
lok_preinit_2
lok_resetAbort
lok_setOperationTimeout
malloc
ntohs
pthread_self
strerror
```

## Forbidden upstream-only `lok_*` exports

```text
lok_clearCallbackQueue
lok_disableSyncEvents
lok_documentCreateView
lok_documentCreateViewWithOptions
lok_documentDestroyView
lok_documentGetA11yCaretPosition
lok_documentGetA11yFocusedParagraph
lok_documentGetCommandValues
lok_documentGetDataArea
lok_documentGetDocumentSize
lok_documentGetDocumentType
lok_documentGetEditMode
lok_documentGetPart
lok_documentGetPartInfo
lok_documentGetPartName
lok_documentGetPartPageRectangles
lok_documentGetParts
lok_documentGetSelectionType
lok_documentGetTextSelection
lok_documentGetTileMode
lok_documentGetView
lok_documentGetViewsCount
lok_documentInitializeForRendering
lok_documentPaintTile
lok_documentPaste
lok_documentPostKeyEvent
lok_documentPostMouseEvent
lok_documentPostUnoCommand
lok_documentRegisterCallback
lok_documentResetSelection
lok_documentSetAccessibilityState
lok_documentSetClientVisibleArea
lok_documentSetClientZoom
lok_documentSetEditMode
lok_documentSetPart
lok_documentSetTextSelection
lok_documentSetView
lok_documentUnregisterCallback
lok_enableSyncEvents
lok_flushCallbacks
lok_getCallbackEventCount
lok_hasCallbackEvents
lok_pollCallback
lok_runLoop
```
