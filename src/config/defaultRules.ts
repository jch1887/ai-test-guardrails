export interface DeterminismRuleConfig {
  detectWaitForTimeout: boolean;
  detectHardSleeps: boolean;
  detectRandomWithoutSeed: boolean;
  detectUnboundedRetries: boolean;
  detectUnmockedNetworkCalls: boolean;
  detectDynamicSelectors: boolean;
}

export interface ArchitectureRuleConfig {
  enforcePageObjects: boolean;
  forbidGlobalState: boolean;
  maxDescribeDepth: number;
  forbidDuplicateTestTitles: boolean;
}

export interface FlakeRiskWeightConfig {
  asyncHeavyWeight: number;
  networkDependencyWeight: number;
  multipleNavigationsWeight: number;
  sharedStateWeight: number;
  timingAssertionsWeight: number;
}

export interface RuleConfig {
  determinism: DeterminismRuleConfig;
  architecture: ArchitectureRuleConfig;
  flakeRisk: FlakeRiskWeightConfig;
}

export const DEFAULT_RULES: RuleConfig = {
  determinism: {
    detectWaitForTimeout: true,
    detectHardSleeps: true,
    detectRandomWithoutSeed: true,
    detectUnboundedRetries: true,
    detectUnmockedNetworkCalls: true,
    detectDynamicSelectors: true,
  },
  architecture: {
    enforcePageObjects: true,
    forbidGlobalState: true,
    maxDescribeDepth: 2,
    forbidDuplicateTestTitles: true,
  },
  flakeRisk: {
    asyncHeavyWeight: 0.15,
    networkDependencyWeight: 0.25,
    multipleNavigationsWeight: 0.2,
    sharedStateWeight: 0.2,
    timingAssertionsWeight: 0.2,
  },
};
