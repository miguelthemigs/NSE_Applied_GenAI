// Shared classes for the step panels (mockups Main, Step2Running, Step3, Step4, Mobile).
// A panel is: StepHeader, a body, an optional footer bar and an optional Advanced
// disclosure at the very bottom, all edge to edge inside the white panel card.

/** The padded content area under the step header. */
export const stepBody = 'p-4 sm:p-6 flex flex-col gap-5 min-w-0'

/** The action bar at the bottom of a panel (full width, top rule); stepFooterEnd keeps one action on the right. */
const footerBase = 'px-4 sm:px-6 py-4 border-t border-surface-container-highest flex flex-wrap gap-3 items-center'
export const stepFooter = `${footerBase} justify-between`
export const stepFooterEnd = `${footerBase} justify-end`

/** The collapsed Advanced disclosure that closes a panel. */
export const advancedDetails = 'border-t border-surface-container-highest bg-surface'
export const advancedSummary =
  'cursor-pointer min-h-[44px] flex items-center gap-2 px-4 sm:px-6 py-3 font-semibold text-on-surface-variant hover:text-primary'
export const advancedBody = 'px-4 sm:px-6 pb-5 pt-1 flex flex-col gap-5 text-sm text-on-surface'

export const primaryButton =
  'inline-flex items-center justify-center gap-2 min-h-[44px] px-[18px] py-2.5 rounded-xl bg-primary text-on-primary text-sm font-semibold no-underline hover:bg-primary-container disabled:bg-surface-container-highest disabled:text-on-surface-variant disabled:cursor-not-allowed'
export const secondaryButton =
  'inline-flex items-center justify-center gap-2 min-h-[44px] px-4 py-2.5 rounded-xl border border-outline-variant bg-surface-container-lowest text-primary text-sm font-semibold no-underline hover:bg-surface-container-low disabled:opacity-50 disabled:cursor-not-allowed'
export const linkButton =
  'inline-flex items-center gap-2 min-h-[44px] px-1 py-2.5 text-sm font-semibold text-primary underline underline-offset-[3px] hover:text-primary-container disabled:opacity-50 disabled:no-underline disabled:cursor-not-allowed'

/** A bordered inset box inside a step body (radio cards, settings groups). */
export const insetCard = 'border border-outline-variant rounded-xl p-4 sm:p-5 min-w-0'
/** A grey note box (hints, optional-step explanation). */
export const noteBox = 'flex gap-3 items-start bg-surface-container-low rounded-xl px-4 py-3.5 text-sm text-on-surface-variant'
export const errorBox = 'flex items-start gap-3 rounded-xl bg-error-container text-on-error-container p-4'

export const fieldLabel = 'text-sm font-semibold text-on-surface'
export const textInput =
  'w-full min-h-[44px] rounded-xl border border-outline-variant bg-surface-container-lowest px-3 py-2 text-sm text-on-surface placeholder:text-outline focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary disabled:bg-surface-container-low disabled:text-outline'
export const checkbox = 'w-5 h-5 m-0 mt-0.5 shrink-0 accent-primary'
