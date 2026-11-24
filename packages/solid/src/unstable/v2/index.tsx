/**
 * `@wardic/solid/unstable/v2`, deprecated: `@wardic/solid` since 2.0, where Solid 2's binding left
 * `unstable/` (#566). An app that adopted it before 2.0 keeps working; each name it re-exports is
 * `@deprecated`, so an editor marks the import. It goes at Wardic's next major. Every name the root
 * exports is here, held so by `test/entries.ssr.test.tsx`.
 *
 * @module
 */
export {
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  createInstantLayoutTransition,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  createInstantTransition,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  createResetProjection,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  runScoped,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  useAnimateLayout,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  useWardicFiber,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  useWardicGate,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  useWardicRuntime,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  WardicProvider,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  LazyWardic,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  type Feature,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  type FeatureLoad,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  type Features,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  type FeaturesProp,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  colors,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  layout,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  scroll,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  drag,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  focus,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  hover,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  inView,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  pan,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  press,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  domAnimation,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  domMax,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  type InstantTransition,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  correctParentTransform,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  transformViewBoxPoint,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  type WardicEnv,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  type WardicRuntime,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  type WardicServices,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  type AnimateLayout,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  WardicConfig,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  type WardicConfigProps,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  type AnyWard,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  type Ward,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  type WardChecked,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  type WardConfig,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  type WardOptions,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  type WardProps,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  type WardRead,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  type WardStyle,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  type WardWithProps,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  ward,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  type HeldWard,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  type SceneObjectEvent,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  type SceneObjectEvents,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  type SceneObjectExit,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  type SceneWard,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  type Stage,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  type StageBatch,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  type StageBatchBinding,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  type StageBatchEvents,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  type StageBatchHooks,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  type StageBatchMemberInfo,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  type StageBatchMembers,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  type StageBatchTarget,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  type StageBatchValues,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  type StageCountBatchConfig,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  type StageDrag,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  type StageDragConfig,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  type StageDragHandlers,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  type StageDragRange,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  type StageDragTransition,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  type StageEvent,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  type StageEvents,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  stageSceneObject,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  type StageGraph,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  type StageMembership,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  type StageKeyedBatchConfig,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  type StageRead,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  type StageReadKey,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  type StageReads,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  type StageSubject,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  type StageSubjectOf,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  type StageSubjects,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  type StageValueKey,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  type StageValueOf,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  type StageValues,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  type StageWard,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  stageWard,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  wardOnStage,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  createBatchOnStage,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  createDragOnStage,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  createHoverOnStage,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  createPressOnStage,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  type StageWardChecked,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  type StageWardConfig,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  type StageWardConfigValues,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  type StageWardEnvironment,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  WardicStage,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  type WardDragInfo,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  type WardElement,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  type WardEvent,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  type WardEvents,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  type WardGestures,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  type WardPoint,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  type WardPointInfo,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  type WardPressInfo,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  type WardSettled,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  type WardicAnimationDefinition,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  type AnimatedKey,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  type WardKey,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  type WardValueOf,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  useVariantContext,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  WardicVariantContext,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  type WardicVariantContextValue,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  type WardicOrchestration,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  type WardicReducedMotion,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  type WardicSkipAnimations,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  type WardicInertia,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  type WardicStagger,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  type WardicPath,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  type WardicPropagate,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  type WardicTransformShorthands,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  type WardicTransition,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  type WardicTransitionEntries,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  type WardicValueKey,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  type WardicValueTransition,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  type WardicKeyframes,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  type WardicTargetValues,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  type WardicValues,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  type WardicVariant,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  type WardicVariantLabels,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  type WardicVariantResolver,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  type WardicVariants,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  type WardicVariantTransition,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  type GivenWard,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  type Wardic,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  type WardicBeside,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  type WardicComponent,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  type WardicMotion,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  type WardicProps,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  type WardicWrappable,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  type WardicWrapped,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  type WardNodeKey,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  type WardRefCallback,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  wardic,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  type W,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  w,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  type WardConfigOf,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  type WardicInstance,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  createWardic,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  type WardicMotionProps,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  isWardicComponent,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  unwrapWardicComponent,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  type WardicCreateOptions,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  isValidWardicProp,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  AnimatePresence,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  type AnimatePresenceProps,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  PresenceContext,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  usePresenceContext,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  type IsPresent,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  type PresenceExit,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  type PresenceLeaveEvents,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  useIsPresent,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  usePresence,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  usePresenceData,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  createPresence,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  type Presence,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  type PresenceEvent,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  type PresenceEvents,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  type PresenceContextValue,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  type PresenceMode,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  type PresenceRecord,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  LayoutGroup,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  measureLayoutBox,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  type CreateDragOptions,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  createInView,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  createPageInView,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  createReducedMotion,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  createReducedMotionConfig,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  type Sensor,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  createDrag,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  createFocus,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  createHover,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  createPress,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  createCycle,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  type Cycle,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  fromAtom,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  streamToSignal,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  type WardicDragTransition,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  type WardicLayoutBox,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  type WardicScaleCorrector,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  type WardicTransformPoint,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  type WardicTransformTemplate,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  type WardicViewport,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  type WardicBoundingBox,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  type WardicDragConstraints,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  type WardicMeasureDragConstraints,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  createDragControls,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  type WardicDragControls,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  type WardicDragControlsOptions,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  createAnimate,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  type WardicAnimationScope,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  type WardicScopeLanding,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  createBatch,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  type WardicBatch,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  type WardicBatchConfig,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  type WardicBatchEvents,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  type WardicBatchMember,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  type WardicBatchMemberProps,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  type WardicBatchPointInfo,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  type WardicBatchPressInfo,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  type WardicKeyedBatch,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  type WardicKeyedBatchConfig,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  type WardicBatchExit,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  type WardicBatchGesture,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  type WardicBatchKey,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  type WardicBatchLanding,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  type WardicBatchSegmentTarget,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  type WardicBatchSegmentValue,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  type WardicBatchStop,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  type WardicBatchSubject,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  type WardicBatchTarget,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  type WardicBatchTransition,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  type WardicBatchValues,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  type WardicAnimate,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  type WardicAnimateOptions,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  type WardicAnimationSequence,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  type WardicAnimationSubject,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  type WardicBatchSegment,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  type WardicElementSegment,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  type WardicFunctionSegment,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  type WardicPlaybackControls,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  type WardicPlayState,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  type WardicSegment,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  type WardicSegmentOptions,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  type WardicSegmentTarget,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  type WardicSequenceLabel,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  type WardicSequenceOptions,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  type WardicSequenceTime,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  createAnimationControls,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  type WardicAnimationControls,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  type WardicControlsDefinition,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  createAnimationFrame,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  createFrameEffect,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  createFollowValue,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  createSpring,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  createTime,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  createTransform,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  createVelocity,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  createWillChange,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  createScroll,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  type ElementSource,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  type ScrollOptions,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  type ScrollValues,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  type FollowAccessor,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  type FollowValueOptions,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  type Live,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  type LiveSource,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  type SpringAccessor,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  type WillChange,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  type AnyReorderGroup,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  type AnyReorderItem,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  type GroupRefCallback,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  Reorder,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  type ReorderElementTag,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  type ReorderGroup,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  type ReorderGroupComponentProps,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  type ReorderGroupConfig,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  type ReorderGroupEvents,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  type ReorderGroupOf,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  type ReorderGroupProps,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  reorderGroup,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  type ReorderItem,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  type ReorderItemComponentProps,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  type ReorderItemConfig,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  type ReorderItemLayout,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  type ReorderItemOf,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  reorderItem,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  type ReorderBatchColumnSize,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  type ReorderBatchGap,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  type ReorderBatchGroup,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  type ReorderBatchGroupProps,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  type ReorderBatchItemProps,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  type ReorderBatchItemSize,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  type ReorderBatchSizing,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  anticipate,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  backIn,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  backInOut,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  backOut,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  circIn,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  circInOut,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  circOut,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  cubicBezier,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  easeIn,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  easeInOut,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  easeOut,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  steps,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  stagger,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  type WardicStaggerOptions,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  arc,
  /** @deprecated `@wardic/solid/unstable/v2` is `@wardic/solid` since 2.0: import it from there. This alias goes at Wardic's next major (#566). */
  type WardicArcOptions,
} from "../../index.tsx"
