import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const patch = readFileSync(
  new URL('../build/patches/wasm-native-conversion-bridge.patch', import.meta.url),
  'utf8'
);
const noPthreadPatch = readFileSync(
  new URL('../build/patches/wasm-no-pthread-single-profile.patch', import.meta.url),
  'utf8'
);
const buildScript = readFileSync(
  new URL('../build/build-wasm.sh', import.meta.url),
  'utf8'
);
const patchStackScript = readFileSync(
  new URL('../build/patch-stack.sh', import.meta.url),
  'utf8'
);
const workflow = readFileSync(
  new URL('../.github/workflows/build-wasm.yml', import.meta.url),
  'utf8'
);

describe('native conversion source and build gates', () => {
  it('keeps the bridge patch limited to the four reviewed LibreOffice files', () => {
    const touchedFiles = [...patch.matchAll(
      /^diff --git a\/(\S+) b\/(\S+)$/gm
    )].map((match) => {
      expect(match[2]).toBe(match[1]);
      return match[1];
    });

    expect(touchedFiles).toEqual([
      'desktop/Executable_soffice_bin.mk',
      'desktop/source/lib/init.cxx',
      'include/sfx2/sfxbasecontroller.hxx',
      'sfx2/source/view/sfxbasecontroller.cxx',
    ]);
  });

  it('exports bridge and legacy symbols together in the first bridge artifact', () => {
    const exportLine = patch.split(/\r?\n/).find(
      (line) => line.startsWith('+') && line.includes('EXPORTED_FUNCTIONS=')
    );

    expect(exportLine).toBeDefined();
    for (const symbol of [
      '_main',
      '_lok_convertDocument',
      '_lok_convertFree',
      '_lok_documentLoad',
      '_lok_documentLoadWithOptions',
      '_lok_documentSaveAs',
      '_lok_documentDestroy',
      '_malloc',
      '_free',
    ]) {
      expect(exportLine).toContain(`"${symbol}"`);
    }
  });

  it('matches the official hidden load and explicit export property sets', () => {
    expect(patch).toContain(
      '+#include <comphelper/namedvaluecollection.hxx>'
    );
    for (const property of ['ReadOnly', 'OpenNewView', 'Hidden', 'Silent']) {
      expect(patch).toContain(
        `comphelper::makePropertyValue(u"${property}"_ustr, true)`
      );
    }
    expect(patch).toMatch(
      /loadComponentFromURL\([\s\S]*aRequest\.maInputURL, u"_blank"_ustr, 0,/
    );
    expect(patch).toContain(
      'u"ConversionRequestOrigin"_ustr, u"CommandLine"_ustr'
    );
    expect(patch).toContain(
      'comphelper::makePropertyValue(u"Overwrite"_ustr, true)'
    );
    expect(patch).toContain(
      'u"FilterName"_ustr, aRequest.maOutputFilter'
    );
  });

  it('falls back from close to dispose and marks cleanup uncertain', () => {
    expect(patch).toMatch(
      /xCloseable->close\(true\);[\s\S]*?catch \(\.\.\.\)[\s\S]*?xComponent->dispose\(\);[\s\S]*?return "uncertain";/
    );
    expect(patch).toContain(
      'Document cleanup is uncertain; runtime must be terminated'
    );
  });

  it('contains an outer exception barrier and matching native allocator', () => {
    expect(patch).toMatch(
      /int lok_convertDocument\([\s\S]*?try[\s\S]*?nativeConvertDocumentImpl\([\s\S]*?catch \(\.\.\.\)[\s\S]*?nativeConversionWriteBoundaryFailure/
    );
    expect(patch).toMatch(
      /void lok_convertFree\(char\* pAllocation\) noexcept[\s\S]*?free\(pAllocation\);/
    );
    expect(patch).toContain(
      'char* pAllocation = static_cast<char*>(malloc(aEncoded.getLength() + 1))'
    );
  });

  it('strictly validates request JSON before adapting filter data', () => {
    expect(patch).toContain('class NativeConversionJSONParser');
    expect(patch).toContain('Unknown request field');
    expect(patch).toContain('Duplicate request field');
    expect(patch).toMatch(
      /case FIELD_SCHEMA_VERSION:[\s\S]*?parseNumber\(aNumber\)[\s\S]*?aNumber != "1"/
    );
    expect(patch).not.toContain('aSchemaVersion->data()');

    expect(patch).toMatch(
      /if \(aName == "type"\)[\s\S]*?parseString\(rType\)/
    );
    expect(patch).toMatch(
      /else if \(aName == "value"\)[\s\S]*?parseString\(rValue\)/
    );
    for (const diagnostic of [
      'Duplicate filterData entry',
      'Duplicate filterData type field',
      'Duplicate filterData value field',
      'Unknown filterData entry field',
    ]) {
      expect(patch).toContain(diagnostic);
    }
    expect(patch).toMatch(
      /Property tree is[\s\S]{0,100}?used only to adapt those validated scalars to PropertyValue\./
    );
  });

  it('derives visible-frame evidence from the non-hidden ConnectSfxFrame branch', () => {
    expect(patch).toMatch(
      /ConnectSfxFrame_Impl[\s\S]*?if \( !rFrame\.IsMarkedHidden_Impl\(\) \)[\s\S]*?gWasmVisibleFrameSetupEntered\.store\(true, std::memory_order_relaxed\);/
    );
    expect(patch).toContain(
      'SfxBaseController::WasWasmVisibleFrameSetupEntered()'
    );
    expect(patch).toMatch(
      /nativeConversionHiddenLoadConfirmed\([\s\S]*?xModel->getArgs\(\)[\s\S]*?u"Hidden"_ustr/
    );
  });

  it('classifies patch files before applying and fails hard on mixed state', () => {
    for (const state of ['applied', 'pending', 'inconsistent']) {
      expect(patchStackScript).toContain(`printf '%s\\n' '${state}'`);
    }
    expect(patchStackScript).toMatch(
      /patch --reverse --force[^\n]*--fuzz=0 --dry-run/
    );
    expect(patchStackScript).toMatch(
      /patch --forward[^\n]*--fuzz=0 --dry-run/
    );

    const stateCase = buildScript.match(
      /case "\$patch_state" in([\s\S]*?)\n    esac/
    )?.[1];
    expect(stateCase).toBeDefined();
    expect(stateCase).toMatch(/pending\)[\s\S]*?apply_pending_patch/);
    expect(stateCase?.match(/apply_pending_patch/g)).toHaveLength(1);
    expect(stateCase).toMatch(
      /inconsistent\)[\s\S]*?Refusing a partial or fuzzy reapply[\s\S]*?return 1/
    );
    expect(buildScript).not.toContain('patch -f -p1');
  });

  it('normalizes cached source without deleting ignored build outputs', () => {
    expect(buildScript).toContain(
      'if [ "$RESET_PATCHED_SOURCE" = "1" ] || [ "$CLEAN_BUILD" = "1" ]'
    );
    expect(buildScript).toContain(
      'reset_patched_source "${ACTIVE_PATCHES[@]}"'
    );
    expect(patchStackScript).toContain('git reset --hard HEAD');
    expect(patchStackScript).toContain('git clean -fd');
    expect(patchStackScript).toMatch(
      /--- \\\/dev\\\/null[\s\S]*?^\s*git clean -fdx -- "\$created_path"/m
    );
    expect(
      patchStackScript.match(/^\s*git clean -fdx(?:\s|$).*$/gm)
    ).toEqual(['        git clean -fdx -- "$created_path"']);
  });

  it('resets cached source and removes stale artifacts before the build', () => {
    expect(workflow).toContain("RESET_PATCHED_SOURCE: '1'");

    const cleanupIndex = workflow.indexOf('rm -f wasm/soffice.*');
    const buildIndex = workflow.indexOf('bash build/build-wasm.sh');
    const verifyIndex = workflow.indexOf('- name: Verify no-pthread runtime contract');
    const conversionGateIndex = workflow.indexOf('- name: Run fresh native conversion gate');
    const uploadIndex = workflow.indexOf('- name: Upload no-pthread WASM artifacts');
    expect(cleanupIndex).toBeGreaterThan(-1);
    expect(cleanupIndex).toBeLessThan(buildIndex);
    expect(buildIndex).toBeLessThan(verifyIndex);
    expect(verifyIndex).toBeLessThan(conversionGateIndex);
    expect(conversionGateIndex).toBeLessThan(uploadIndex);
  });

  it('does not fetch obsolete LFS bytes before rebuilding native assets', () => {
    expect(workflow).toContain('lfs: false');
    expect(workflow).toContain('run: node scripts/build-js-bundles.mjs');
    expect(workflow).not.toContain('run: npm run build\n');
  });

  it('pins LibreOffice and applies exports, shims, bridge, then no-pthread', () => {
    expect(buildScript).toContain(
      'LIBREOFFICE_COMMIT="${LIBREOFFICE_COMMIT:-d1c9e0e4e1ddeb24fe8f93e56860b3765043f8b1}"'
    );
    expect(buildScript).toContain('git checkout --detach "${LIBREOFFICE_COMMIT}"');

    const atomNames = [...buildScript.matchAll(
      /apply_conversion_atom\s+\\\s*\r?\n\s*"([^"]+)"/g
    )].map((match) => match[1]);

    expect(atomNames).toEqual([
      'wasm-trim-lok-exports-conversion-only.patch',
      'wasm-trim-lok-shims-conversion-only.patch',
      'wasm-native-conversion-bridge.patch',
    ]);

    const bridgeIndex = buildScript.indexOf('"wasm-native-conversion-bridge.patch"');
    const noPthreadIndex = buildScript.indexOf('"wasm-no-pthread-single-profile.patch"');
    const configureIndex = buildScript.indexOf('./autogen.sh');
    expect(bridgeIndex).toBeGreaterThan(-1);
    expect(noPthreadIndex).toBeGreaterThan(bridgeIndex);
    expect(configureIndex).toBeGreaterThan(noPthreadIndex);
  });

  it('removes native pthread flags and serializes Emscripten-only work', () => {
    const touchedFiles = [...noPthreadPatch.matchAll(
      /^diff --git a\/(\S+) b\/(\S+)$/gm
    )].map((match) => {
      expect(match[2]).toBe(match[1]);
      return match[1];
    });

    expect(touchedFiles).toEqual([
      'solenv/gbuild/platform/EMSCRIPTEN_INTEL_GCC.mk',
      'comphelper/source/misc/threadpool.cxx',
      'configmgr/source/components.cxx',
      'salhelper/source/thread.cxx',
      'desktop/source/lib/init.cxx',
      'toolkit/source/awt/vclxtoolkit.cxx',
    ]);
    const removedLines = noPthreadPatch
      .split(/\r?\n/)
      .filter((line) => line.startsWith('-') && !line.startsWith('---'))
      .join('\n');
    for (const flag of [
      '-pthread',
      'USE_PTHREADS',
      'DEFAULT_PTHREAD_STACK_SIZE',
      'PTHREAD_POOL_SIZE',
      'PROXY_TO_PTHREAD',
    ]) {
      expect(removedLines).toContain(flag);
    }
    expect(noPthreadPatch).toContain(
      '+gb_CXXFLAGS := $(filter-out -pthread,$(gb_CXXFLAGS))'
    );
    expect(noPthreadPatch).toContain('+gb_CXX_LINKFLAGS :=');
    expect(buildScript).toContain(
      "grep -Fqx 'gb_CXXFLAGS := $(filter-out -pthread,$(gb_CXXFLAGS))'"
    );
    expect(buildScript).toContain(
      "grep -Fqx 'gb_CXX_LINKFLAGS :='"
    );
    expect(buildScript).toContain(
      'Emscripten platform still contains active pthread settings'
    );
    expect(noPthreadPatch).toContain('+    pTask->mpTag->onTaskPushed();');
    expect(noPthreadPatch).toContain('+    std::shared_ptr<ThreadTaskTag> pTag(pTask->mpTag);');
    expect(noPthreadPatch).toContain('+    pTask->exec();');
    expect(noPthreadPatch).toContain('+    pTag->onTaskWorkerDone();');
    expect(noPthreadPatch).toContain(
      '+            writeModFile(*this, modificationFileUrl_, data_);'
    );
    expect(noPthreadPatch).toContain(
      '+        throw std::runtime_error(std::string("osl::Thread::create failed: ") + name_);'
    );
    expect(noPthreadPatch).toContain('+    if (pLib->maThread)');
    expect(noPthreadPatch).toContain('+#include <comphelper/lok.hxx>');
    expect(noPthreadPatch).toMatch(
      /if\( nVCLToolkitInstanceCount == 1 && !Application::IsInMain\(\) &&\s*\n\+        !comphelper::LibreOfficeKit::isActive\(\) \)/
    );
  });

  it('inspects generated native output before packaging it', () => {
    const inspectIndex = buildScript.indexOf('inspect-no-pthread-runtime.mjs');
    const copyIndex = buildScript.indexOf('cp "${ARTIFACT_DIR}/soffice.wasm"');
    expect(inspectIndex).toBeGreaterThan(-1);
    expect(copyIndex).toBeGreaterThan(inspectIndex);
    expect(workflow).toContain('run: npm run verify:no-pthread');
    expect(workflow).toContain('name: soffice-wasm-no-pthread-${{ github.run_id }}');
  });
});
