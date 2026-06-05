/**
 * Ambient declaration to work around a type bug in unconfig@7.x where
 * `Args` is referenced without being imported in the generated .d.mts file.
 * This fixes the tsc error: "Cannot find name 'Args'"
 * which surfaces when vite-plugin-pwa's peer @vite-pwa/assets-generator
 * transitively depends on unconfig.
 *
 * This declaration only affects the TypeScript compiler — it has no runtime
 * effect and does not weaken project source checks.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare type Args = any[]
