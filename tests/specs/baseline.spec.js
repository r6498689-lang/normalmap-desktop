'use strict';

/*
 * baseline.spec.js
 * The migration must not change a single pixel of the generated maps.
 *
 * Method: the pristine upstream copy (tests/baseline/site, byte-identical to
 * the original download) is served from app://baseline inside the same
 * Electron build. Both pages get the same input through the same <input>
 * element, then every generated canvas is exported with toDataURL('image/png')
 * and decoded with nativeImage so raw pixels — not file sizes — are compared.
 */

const driver = require('../lib/driver');

const CASES = [
  { label: 'default-512-standard-height', file: null },
  { label: 'height-bumps-256', file: driver.fixture('height-bumps-256.png') },
  { label: 'non-square-300x200', file: driver.fixture('height-300x200.png') },
  { label: 'non-pow2-255x257', file: driver.fixture('height-255x257.png') },
  { label: 'colour-basecolor-256', file: driver.fixture('basecolor-color-256.png') },
  { label: 'alpha-192', file: driver.fixture('height-alpha-192.png') }
];

module.exports.run = async function run(ctx) {
  await driver.waitForBoot(ctx);
  const baseline = await ctx.openBaseline();
  await ctx.waitForIn(baseline, 'window.NMO_Main && NMO_NormalMap.normal_canvas.width > 0', 30000);

  const failures = [];
  const cases = [];

  for (const testCase of CASES) {
    if (testCase.file) {
      await driver.loadHeightFile(ctx, testCase.file);
      // Load into the baseline through the identical code path.
      const size = require('../lib/imageinfo').readImageSize(testCase.file);
      await ctx.setFileInput(baseline, '#select_file_height', [testCase.file]);
      await ctx.waitForIn(
        baseline,
        `NMO_NormalMap.normal_canvas.width === ${size.width} && ` +
          `NMO_NormalMap.normal_canvas.height === ${size.height}`,
        25000
      );
      await ctx.wait(700);
    } else {
      await ctx.wait(600);
    }

    const desktop = {};
    const original = {};
    const comparison = {};

    for (const which of ['normal', 'displacement', 'ambient', 'specular']) {
      desktop[which] = await driver.canvasPng(ctx, which);
      original[which] = await baseline.webContents.executeJavaScript(
        `(function(){
          var map = {
            normal: NMO_NormalMap.normal_canvas,
            displacement: NMO_DisplacementMap.displacement_canvas,
            ambient: NMO_AmbientOccMap.ao_canvas,
            specular: NMO_SpecularMap.specular_canvas
          };
          return map[${JSON.stringify(which)}].toDataURL('image/png');
        })()`,
        true
      );

      comparison[which] = ctx.compare(desktop[which], original[which]);
      if (comparison[which].decodeFailed) {
        failures.push(`${testCase.label}/${which}: image could not be decoded, comparison is invalid`);
      } else if (!comparison[which].identical) {
        failures.push(
          `${testCase.label}/${which}: ${comparison[which].differingPixels} px differ ` +
            `(max channel delta ${comparison[which].maxChannelDelta}, sizes ` +
            `${comparison[which].sizeA.width}x${comparison[which].sizeA.height} vs ` +
            `${comparison[which].sizeB.width}x${comparison[which].sizeB.height})`
        );
      }
    }

    cases.push({
      label: testCase.label,
      input: testCase.file ? require('node:path').basename(testCase.file) : 'bundled standard_height.png',
      size: comparison.normal.sizeA,
      pixelCount: comparison.normal.sizeA.width * comparison.normal.sizeA.height,
      identical:
        !Object.values(comparison).some((c) => c.decodeFailed) &&
        Object.values(comparison).every((c) => c.identical),
      hashes: {
        desktop: Object.fromEntries(Object.entries(desktop).map(([k, v]) => [k, driver.hashOf(v)])),
        upstream: Object.fromEntries(Object.entries(original).map(([k, v]) => [k, driver.hashOf(v)]))
      },
      comparison
    });

    if (testCase.file === null) {
      await ctx.screenshot('baseline-default-desktop.png');
    }
  }

  baseline.destroy();
  await ctx.wait(300);

  return {
    ok: failures.length === 0,
    spec: 'baseline',
    method:
      'both pages run the same renderer code in the same Electron process; ' +
      "canvases exported with toDataURL('image/png'), decoded with nativeImage, compared per pixel",
    cases,
    failures,
    checkedAt: new Date().toISOString()
  };
};
