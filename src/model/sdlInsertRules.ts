import type { SdlInsertKind, SdlSymbolKind } from './types';

const TRANSITION_FOLLOWERS: readonly SdlInsertKind[] = [
    'task',
    'output',
    'procedureCall',
    'decision',
    'alternative',
    'nextstate',
    'join',
    'label',
    'connect',
    'return',
    'comment',
    // A state can be inserted as a transition target.
    'state',
];

/** Symbols that can be created directly from the canvas context menu. */
export const SDL_CANVAS_INSERT_TYPES: readonly SdlInsertKind[] = [
    'procedure',
    'state',
    'label',
];

/**
 * Symbols that can be created after a given symbol kind.
 * Includes the special pseudo-kind `decisionAlternative` for decision branches.
 */
export const SDL_FOLLOW_INSERT_TYPES_BY_SYMBOL: Readonly<Record<SdlSymbolKind, readonly SdlInsertKind[]>> = {
    start: TRANSITION_FOLLOWERS,
    state: ['input', 'continuousSignal', 'connect'],
    stateAggregation: ['input', 'continuousSignal', 'connect'],
    input: TRANSITION_FOLLOWERS,
    continuousSignal: TRANSITION_FOLLOWERS,
    output: TRANSITION_FOLLOWERS,
    task: TRANSITION_FOLLOWERS,
    decision: ['decisionAlternative', ...TRANSITION_FOLLOWERS],
    answer: TRANSITION_FOLLOWERS,
    alternative: ['decisionAlternative', ...TRANSITION_FOLLOWERS],
    nextstate: TRANSITION_FOLLOWERS,
    procedure: ['start', ...TRANSITION_FOLLOWERS],
    procedureCall: TRANSITION_FOLLOWERS,
    return: TRANSITION_FOLLOWERS,
    join: TRANSITION_FOLLOWERS,
    label: TRANSITION_FOLLOWERS,
    connect: TRANSITION_FOLLOWERS,
    comment: TRANSITION_FOLLOWERS,
    textArea: [],
};

export const SDL_INSERT_LABELS: Readonly<Record<SdlInsertKind, string>> = {
    start: 'Start',
    state: 'State (target)',
    input: 'Input',
    continuousSignal: 'Provided',
    output: 'Output',
    task: 'Task',
    decision: 'Decision',
    alternative: 'Alternative',
    nextstate: 'Nextstate',
    procedure: 'Procedure',
    procedureCall: 'Procedure Call',
    return: 'Return',
    join: 'Join',
    label: 'Label',
    connect: 'Connect',
    comment: 'Comment',
    decisionAlternative: 'Alternative Branch',
};

/**
 * Median vertical top-to-top spacing observed across reference SDL examples.
 * Computed from vertical graph edges in the workspace corpus.
 */
export const SDL_INSERT_VERTICAL_DELTA = 55;

/** Typical horizontal spacing between sibling decision answers in reference SDL files. */
export const SDL_DECISION_BRANCH_HORIZONTAL_DELTA = 290;
