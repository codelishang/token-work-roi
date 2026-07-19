export interface UsageRow extends Record<string, unknown> {
  id?: string | number;
  device?: string;
  source?: string;
  sessionId?: string;
  session_id?: string;
  project?: string;
  projectAlias?: string;
  projectPath?: string;
  ruleProjectAlias?: string;
  projectName?: string;
  taskType?: string;
  outputStatus?: string;
  workPurpose?: string;
  workStage?: string;
  valueLevel?: string;
  note?: string;
  annotationSource?: string;
  annotationConfidence?: number;
  attributionQuality?: string;
  autoSuggestion?: { canApply?: boolean } | null;
  outputUrl?: string;
  outputLabel?: string;
  outputType?: string;
  model?: string;
  pricingModel?: string;
  pricingProvider?: string;
  pricingStatus?: string;
  pricingReason?: string;
  usageDate?: string;
  lastActivity?: string;
  lastSeenAt?: string;
  updatedAt?: string;
  createdAt?: string;
  completedAt?: string;
  collectedAt?: string;
  date?: string;
  day?: string;
  pattern?: string;
  message?: string;
  category?: string;
  title?: string;
  action?: string;
  evidence?: string;
  sourceRule?: string;
  status?: string;
  periodStart?: string;
  periodEnd?: string;
  total?: number;
  input?: number;
  output?: number;
  cost?: number;
  inputTokens?: number;
  input_tokens?: number;
  outputTokens?: number;
  output_tokens?: number;
  cacheReadTokens?: number;
  cache_read_tokens?: number;
  cacheCreationTokens?: number;
  cache_creation_tokens?: number;
  cachedInputTokens?: number;
  reasoningTokens?: number;
  reasoningOutputTokens?: number;
  reasoning_output_tokens?: number;
  totalTokens?: number;
  total_tokens?: number;
  costUSD?: number;
  cost_usd?: number;
}

export interface PeriodRange extends Record<string, unknown> {
  id?: string;
  label?: string;
  start?: string;
  end?: string;
  startDateTime?: string;
  endDateTime?: string;
  pretty?: string;
}

export interface UsageAggregate {
  sessionCount: number;
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  costUSD: number;
}
