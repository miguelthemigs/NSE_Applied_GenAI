import { useMemo, useState, useEffect } from "react";
import {
  Link,
  NavLink,
  useLocation,
  useParams,
  useNavigate,
  useSearchParams,
} from "react-router-dom";
import { useThemeSummary } from "../hooks/useThemeSummary";
import FilterDropdown from "../components/FilterDropdown";
import { LOCATION_OPTIONS } from "../constants/locations";
import { getThemeColor } from "../constants/themeColors";
import { buildRealTheme, REAL_THEME_META, THEME_NAME_BY_ID, themeLabel, themeText } from "../constants/realThemes";
import { useI18n } from "../i18n/I18nProvider";
import { motion } from "framer-motion";
import { apiUrl } from "../services/api";
import {
  filtersFromSearchParams,
  filtersToApiParams,
  filtersToSearchParams,
  hasActiveFilters as filtersHaveActiveValues,
  normalizeFilters,
  searchFromFilters,
} from "../utils/filters";

function normaliseComment(comment) {
  return String(comment || "").replace(/^"+|"+$/g, "");
}

const INSIGHT_STOPWORDS = new Set([
  "about",
  "after",
  "again",
  "also",
  "although",
  "because",
  "been",
  "being",
  "between",
  "could",
  "from",
  "have",
  "however",
  "into",
  "more",
  "most",
  "other",
  "over",
  "students",
  "that",
  "their",
  "there",
  "these",
  "they",
  "this",
  "those",
  "through",
  "under",
  "very",
  "while",
  "with",
  "would",
  "waar",
  "worden",
  "heeft",
  "hebben",
  "voor",
  "door",
  "maar",
  "niet",
  "zijn",
  "deze",
  "over",
  "meer",
]);

function insightTokens(value) {
  return (
    String(value || "")
      .toLowerCase()
      .match(/[a-zA-ZÀ-ÿ0-9]+/g)
      ?.filter((token) => token.length > 3 && !INSIGHT_STOPWORDS.has(token)) ??
    []
  );
}

function cleanInsightPoint(value) {
  const cleaned = String(value || "")
    .trim()
    .replace(/^(while|although|however|but|yet)\s+/i, "")
    .replace(/\s+/g, " ");

  if (!cleaned) return "";
  const capitalized = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
  return /[.!?]$/.test(capitalized) ? capitalized : `${capitalized}.`;
}

function buildPointCards(points, comments) {
  const sourceComments = (comments || [])
    .map(normaliseComment)
    .filter((comment) => comment.length > 1);
  const usedCommentIndexes = new Set();

  return (points || [])
    .map((point, pointIndex) => {
      const cleanPoint = cleanInsightPoint(point);
      const pointRoots = new Set(
        insightTokens(point).map((token) => token.slice(0, 6)),
      );
      const ranked = sourceComments
        .map((comment, commentIndex) => {
          const commentRoots = new Set(
            insightTokens(comment).map((token) => token.slice(0, 6)),
          );
          const overlap = [...pointRoots].filter((root) =>
            commentRoots.has(root),
          ).length;
          const fallbackDistance =
            (commentIndex - pointIndex * 3 + sourceComments.length) %
            sourceComments.length;
          return { comment, commentIndex, overlap, fallbackDistance };
        })
        .sort(
          (a, b) =>
            b.overlap - a.overlap || a.fallbackDistance - b.fallbackDistance,
        );

      const relatedComments = [];
      ranked.forEach((candidate) => {
        if (
          relatedComments.length >= 3 ||
          (candidate.overlap === 0 && relatedComments.length > 0) ||
          usedCommentIndexes.has(candidate.commentIndex)
        )
          return;
        usedCommentIndexes.add(candidate.commentIndex);
        relatedComments.push(candidate.comment);
      });

      return { point: cleanPoint, relatedComments };
    })
    .filter((item) => item.point);
}

function subthemeTokens(subtheme) {
  const stopwords = new Set([
    "and",
    "the",
    "for",
    "with",
    "from",
    "that",
    "this",
    "over",
    "into",
  ]);
  return (
    String(subtheme || "")
      .toLowerCase()
      .match(/[a-z0-9]+/g)
      ?.filter((token) => token.length > 3 && !stopwords.has(token)) ?? []
  );
}

function buildSubthemeRows(subthemes, apiRows, sourceComments) {
  if (apiRows?.length > 0) {
    return apiRows.map((row) => {
      const percentage = Number(row.percentage);
      const mentions = Number(row.mentions);

      return {
        subtheme: row.subtheme,
        percentage: Number.isFinite(percentage) ? percentage : 0,
        mentions: Number.isFinite(mentions) ? mentions : 0,
        docPercentage: Number.isFinite(Number(row.doc_percentage))
          ? Number(row.doc_percentage)
          : null,
        quote_count: row.quote_count != null ? Number(row.quote_count) : null,
      };
    });
  }

  const comments = sourceComments
    .map((comment) => String(comment).toLowerCase())
    .filter(Boolean);
  const rows = subthemes.map((subtheme) => {
    const tokens = subthemeTokens(subtheme);
    const mentions = comments.filter((comment) =>
      tokens.some(
        (token) =>
          comment.includes(token) || comment.includes(token.slice(0, 6)),
      ),
    ).length;

    return {
      subtheme,
      mentions,
      docPercentage:
        comments.length > 0
          ? Math.round((mentions / comments.length) * 100)
          : 0,
      percentage: 0,
    };
  });
  const totalMentions = rows.reduce((sum, row) => sum + row.mentions, 0);
  return rows.map((row) => ({
    ...row,
    percentage:
      totalMentions > 0 ? Math.round((row.mentions / totalMentions) * 100) : 0,
  }));
}

// ── Comment card with expand/collapse ────────────────────────────────────────
function CommentCard({ comment, accentColor, index = 0 }) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const text = normaliseComment(comment);
  const isLong = text.length > 180;
  const displayText = expanded
    ? text
    : isLong
      ? text.slice(0, 170) + "..."
      : text;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        duration: 0.4,
        delay: Math.min(index * 0.03, 0.5),
        ease: [0.16, 1, 0.3, 1],
      }}
      onClick={() => isLong && setExpanded(!expanded)}
      className={`bg-surface-container-lowest rounded-xl p-4 flex flex-col justify-between shadow-sm transition-all duration-200 border ${
        isLong ? "cursor-pointer select-none hover:shadow-md" : ""
      }`}
      style={{
        borderColor: expanded ? `${accentColor}30` : "rgba(114,119,129,0.1)",
      }}
    >
      <blockquote className="text-sm text-on-surface-variant leading-relaxed italic">
        "{displayText}"
      </blockquote>
      {isLong && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            setExpanded(!expanded);
          }}
          className="mt-3 flex items-center gap-1 text-[11px] font-bold hover:opacity-80 transition-colors self-end uppercase tracking-wider"
          style={{ color: accentColor }}
        >
          {expanded ? t("detail.showLess") : t("detail.showMore")}
          <span className="material-symbols-outlined text-xs">
            {expanded ? "keyboard_arrow_up" : "keyboard_arrow_down"}
          </span>
        </button>
      )}
    </motion.div>
  );
}

// ── Suggestion section ──────────────────────────────────────────────────────
function SuggestionCard({ suggestion, accentColor, index = 0 }) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const text = normaliseComment(suggestion);
  const isLong = text.length > 150;

  return (
    <motion.blockquote
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        duration: 0.4,
        delay: Math.min(index * 0.05, 0.3),
        ease: [0.16, 1, 0.3, 1],
      }}
      className="p-4 rounded-xl border-l-4 italic text-sm leading-relaxed flex flex-col"
      style={{
        borderColor: accentColor,
        backgroundColor: `${accentColor}08`,
        color: "#1e293b",
      }}
    >
      <span className={expanded ? "" : "line-clamp-5"}>{text}</span>
      {isLong && (
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="mt-2 self-end text-[11px] font-bold not-italic uppercase tracking-wider hover:opacity-80 transition-colors bg-transparent border-none p-0 cursor-pointer"
          style={{ color: accentColor }}
        >
          {expanded ? t("detail.showLess") : t("detail.showMore")}
        </button>
      )}
    </motion.blockquote>
  );
}

function SuggestionSection({ suggestions, accentColor }) {
  const { t } = useI18n();
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.1, ease: [0.16, 1, 0.3, 1] }}
      className="bg-surface-container-lowest rounded-2xl p-4 md:p-6 shadow-sm border border-outline-variant/10"
    >
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2 mb-4">
        <div>
          <div className="flex items-center gap-2">
            <span
              className="material-symbols-outlined text-xl"
              style={{ color: accentColor, fontVariationSettings: "'FILL' 1" }}
            >
              lightbulb
            </span>
            <h2 className="text-base md:text-lg font-bold font-headline text-on-surface">
              {t("detail.suggestions.title")}
            </h2>
          </div>
          <p className="text-xs text-on-surface-variant/65 mt-1">
            {t("detail.suggestions.lead")}
          </p>
        </div>
        <span className="text-[10px] uppercase tracking-wider font-bold text-on-surface-variant">
          {t("detail.suggestions.tag")}
        </span>
      </div>

      {suggestions.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {suggestions.slice(0, 3).map((suggestion, i) => (
            <SuggestionCard
              key={i}
              suggestion={suggestion}
              accentColor={accentColor}
              index={i}
            />
          ))}
        </div>
      ) : (
        <p className="text-sm text-on-surface-variant bg-surface p-4 rounded-xl">
          {t("detail.suggestions.empty")}
        </p>
      )}
    </motion.div>
  );
}

function FeedbackSummaryBlock({
  title,
  eyebrow,
  points,
  comments,
  icon,
  color,
  emptyText,
}) {
  const { t } = useI18n();
  const [expandedIndex, setExpandedIndex] = useState(null);
  const cards = useMemo(
    () => buildPointCards((points || []).slice(0, 3), comments),
    [points, comments],
  );

  return (
    <div
      className="rounded-2xl border p-4 md:p-5 min-h-[280px] flex flex-col"
      style={{ borderColor: `${color}24`, backgroundColor: `${color}07` }}
    >
      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="flex items-start gap-2.5">
          <span
            className="material-symbols-outlined mt-0.5"
            style={{ color, fontVariationSettings: "'FILL' 1" }}
          >
            {icon}
          </span>
          <div>
            <p
              className="text-[10px] font-bold uppercase tracking-wider"
              style={{ color }}
            >
              {eyebrow}
            </p>
            <h3 className="text-base md:text-lg font-bold font-headline text-on-surface">
              {title}
            </h3>
          </div>
        </div>
        <span
          className="shrink-0 text-[10px] font-bold uppercase tracking-wider rounded-full px-2.5 py-1"
          style={{ color, backgroundColor: `${color}12` }}
        >
          {t("detail.top", { n: cards.length || 3 })}
        </span>
      </div>

      {cards.length > 0 ? (
        <div className="space-y-3">
          {cards.map((card, index) => {
            const expanded = expandedIndex === index;
            return (
              <motion.article
                layout
                key={`${title}-${card.point}-${index}`}
                className="rounded-xl bg-surface-container-lowest border border-outline-variant/10 p-4"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{
                  duration: 0.35,
                  delay: index * 0.06,
                  ease: [0.16, 1, 0.3, 1],
                }}
              >
                <div className="flex items-center gap-2 mb-2">
                  <span
                    className="text-[10px] font-bold uppercase tracking-wider rounded-full px-2 py-0.5"
                    style={{ color, backgroundColor: `${color}10` }}
                  >
                    {t("detail.aiSummary", { n: index + 1 })}
                  </span>
                </div>
                <p className="text-sm leading-relaxed text-on-surface">
                  {card.point}
                </p>
                <button
                  type="button"
                  aria-expanded={expanded}
                  onClick={() => setExpandedIndex(expanded ? null : index)}
                  disabled={card.relatedComments.length === 0}
                  className="mt-3 inline-flex items-center gap-1.5 text-xs font-bold border-none bg-transparent cursor-pointer disabled:cursor-default disabled:opacity-50 p-0"
                  style={{ color }}
                >
                  <span className="material-symbols-outlined text-base">
                    forum
                  </span>
                  {card.relatedComments.length > 0
                    ? t(expanded ? "detail.comments.hide" : "detail.comments.read", { n: card.relatedComments.length })
                    : t("detail.comments.none")}
                  <span className="material-symbols-outlined text-base">
                    {expanded ? "expand_less" : "expand_more"}
                  </span>
                </button>

                {expanded && card.relatedComments.length > 0 && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    className="mt-3 space-y-2"
                  >
                    {card.relatedComments.map((comment, commentIndex) => (
                      <blockquote
                        key={`${comment.slice(0, 24)}-${commentIndex}`}
                        className="rounded-lg border-l-2 bg-surface-container px-3 py-2 text-xs leading-relaxed italic text-on-surface-variant"
                        style={{ borderColor: color }}
                      >
                        "{comment}"
                      </blockquote>
                    ))}
                  </motion.div>
                )}
              </motion.article>
            );
          })}
        </div>
      ) : (
        <p className="text-sm text-on-surface-variant bg-surface-container-lowest border border-outline-variant/10 rounded-xl p-4">
          {emptyText}
        </p>
      )}
    </div>
  );
}

function AIFeedbackBento({
  positivePoints,
  negativePoints,
  comments,
  accentColor,
  loading,
}) {
  const { t } = useI18n();
  if (loading) {
    return (
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {[0, 1].map((index) => (
          <div key={index} className="h-[320px] rounded-2xl skeleton-shimmer" />
        ))}
      </div>
    );
  }

  return (
    <motion.section
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.2, ease: [0.16, 1, 0.3, 1] }}
      className="rounded-3xl p-4 md:p-6 shadow-sm border bg-surface-container-lowest"
      style={{ borderColor: `${accentColor}18` }}
    >
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-2 mb-5">
        <div>
          <div className="flex items-center gap-2">
            <span
              className="material-symbols-outlined"
              style={{ color: accentColor, fontVariationSettings: "'FILL' 1" }}
            >
              auto_awesome
            </span>
            <h2 className="text-base md:text-lg font-bold font-headline text-on-surface">
              {t("detail.bento.title")}
            </h2>
          </div>
          <p className="text-xs text-on-surface-variant/65 mt-1">
            {t("detail.bento.lead")}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-stretch">
        <FeedbackSummaryBlock
          title={t("detail.positive.title")}
          eyebrow={t("detail.positive.eyebrow")}
          points={positivePoints}
          comments={comments}
          icon="thumb_up"
          color="#005119"
          emptyText={t("detail.positive.empty")}
        />
        <FeedbackSummaryBlock
          title={t("detail.negative.title")}
          eyebrow={t("detail.negative.eyebrow")}
          points={negativePoints}
          comments={comments}
          icon="report"
          color="#BA1A1A"
          emptyText={t("detail.negative.empty")}
        />
      </div>
    </motion.section>
  );
}

// ── Donut chart — uses shades of one accent color ───────────────────────────
function DonutChart({ rows, title, accentColor }) {
  const { t } = useI18n();
  if (!rows || rows.length === 0) return null;

  const radius = 50;
  const strokeWidth = 14;
  const circ = 2 * Math.PI * radius;
  const shades = [
    accentColor,
    `${accentColor}cc`,
    `${accentColor}99`,
    `${accentColor}66`,
    `${accentColor}44`,
    `${accentColor}30`,
  ];
  const safeRows = rows.map((row) => ({
    ...row,
    percentage: Math.max(0, Number(row.percentage) || 0),
    mentions: Math.max(0, Number(row.mentions) || 0),
    quote_count: row.quote_count != null ? Math.max(0, Number(row.quote_count) || 0) : null,
  }));
  const percentageTotal = safeRows.reduce(
    (sum, row) => sum + row.percentage,
    0,
  );
  const mentionTotal = safeRows.reduce((sum, row) => sum + row.mentions, 0);
  const quoteTotal = safeRows.reduce(
    (sum, row) => sum + (row.quote_count ?? row.mentions),
    0,
  );
  const usePercentages = percentageTotal > 0;
  const valueTotal = usePercentages ? percentageTotal : mentionTotal;
  // Sort highest → lowest so darkest shade always maps to the largest slice
  const sortedSafeRows = [...safeRows].sort((a, b) =>
    usePercentages ? b.percentage - a.percentage : b.mentions - a.mentions,
  );
  let currentOffset = 0;
  const segments = sortedSafeRows.map((row, index) => {
    const value = usePercentages ? row.percentage : row.mentions;
    const normalizedPercentage =
      valueTotal > 0 ? (value / valueTotal) * 100 : 0;
    const segmentLength = (normalizedPercentage / 100) * circ;
    const segment = {
      ...row,
      color: shades[index % shades.length],
      normalizedPercentage,
      strokeLength: Math.max(0, segmentLength - 4),
      strokeOffset: currentOffset,
    };
    currentOffset += segmentLength;
    return segment;
  });

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
      className="bg-surface-container-lowest rounded-2xl p-6 border border-outline-variant/10 shadow-sm flex flex-col items-center gap-4"
    >
      <h3 className="text-xs font-bold uppercase tracking-wider text-on-surface-variant w-full text-left">
        {title || t("detail.breakdown")}
      </h3>
      <div className="relative w-[140px] h-[140px] flex items-center justify-center">
        <svg
          width="140"
          height="140"
          viewBox="0 0 140 140"
          role="img"
          aria-label={title || t("detail.breakdown")}
        >
          <circle
            cx="70"
            cy="70"
            r={radius}
            fill="transparent"
            stroke="#E6E8EE"
            strokeWidth={strokeWidth}
          />
          <g transform="rotate(-90 70 70)">
            {segments.map((segment, index) => (
              <motion.circle
                key={`${segment.subtheme}-${index}`}
                cx="70"
                cy="70"
                r={radius}
                fill="transparent"
                stroke={segment.color}
                strokeWidth={strokeWidth}
                strokeDashoffset={-segment.strokeOffset}
                strokeLinecap="butt"
                className="cursor-pointer"
                initial={{ strokeDasharray: `0 ${circ}` }}
                animate={{
                  strokeDasharray: `${segment.strokeLength} ${circ - segment.strokeLength}`,
                }}
                transition={{
                  duration: 0.7,
                  delay: 0.1 + index * 0.12,
                  ease: [0.16, 1, 0.3, 1],
                }}
                whileHover={{ strokeWidth: strokeWidth + 2 }}
              >
                <title>{`${segment.subtheme}: ${Math.round(segment.normalizedPercentage)}%`}</title>
              </motion.circle>
            ))}
          </g>
        </svg>
        <div className="absolute flex flex-col items-center justify-center">
          <span className="text-[9px] uppercase font-bold text-on-surface-variant/50">
            {t("detail.total")}
          </span>
          <span
            className="text-lg font-extrabold font-headline"
            style={{ color: accentColor }}
          >
            {quoteTotal}
          </span>
          <span className="text-[9px] text-on-surface-variant/70">
            {t("common.comments")}
          </span>
        </div>
      </div>

      {/* Legend */}
      <div className="w-full space-y-2 mt-2 max-h-[160px] overflow-y-auto pr-1 custom-scrollbar">
        {segments.map((segment, index) => (
          <div
            key={`${segment.subtheme}-${index}`}
            className="flex items-center justify-between gap-3 text-xs"
          >
            <div className="flex items-center gap-2 truncate">
              <span
                className="w-2.5 h-2.5 rounded-full shrink-0"
                style={{ backgroundColor: segment.color }}
              />
              <span className="text-on-surface-variant truncate font-medium">
                {segment.subtheme}
              </span>
            </div>
            <span className="font-bold shrink-0" style={{ color: accentColor }}>
              {Math.round(segment.normalizedPercentage)}%
            </span>
          </div>
        ))}
      </div>
    </motion.div>
  );
}

// ── Subtheme horizontal bar list ────────────────────────────────────────────
function SubthemesList({
  rows,
  onSelectSubtheme,
  activeSubtheme,
  accentColor,
  gradient,
}) {
  const { t } = useI18n();
  const sortedRows = [...rows].sort((a, b) => b.percentage - a.percentage);
  const hasRows = sortedRows.length > 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.15, ease: [0.16, 1, 0.3, 1] }}
      className="bg-surface-container-lowest rounded-2xl p-4 md:p-6 shadow-sm border border-outline-variant/10"
    >
      <div className="flex items-center justify-between gap-3 mb-4">
        <h2 className="text-xs font-bold uppercase tracking-wider text-on-surface-variant">
          {t("detail.subthemes.title")}
        </h2>
        <span className="material-symbols-outlined text-outline text-xl">
          layers
        </span>
      </div>

      {hasRows ? (
        <div className="flex flex-col gap-2.5">
          {sortedRows.map((row, idx) => {
            const isActive = activeSubtheme === row.subtheme;
            return (
              <motion.button
                key={row.subtheme}
                initial={false}
                onClick={() => onSelectSubtheme(row.subtheme)}
                className={`w-full text-left p-3.5 rounded-xl border transition-all duration-200 flex flex-col gap-2 group cursor-pointer ${
                  isActive
                    ? "text-white shadow-md"
                    : "bg-surface-container-low hover:bg-surface-container-high border-outline-variant/10 text-on-surface hover:scale-[1.01]"
                }`}
                style={
                  isActive
                    ? {
                        background: gradient,
                        borderColor: accentColor,
                      }
                    : undefined
                }
              >
                <div className="flex justify-between items-center w-full gap-2">
                  <span
                    className={`text-sm font-bold truncate ${
                      isActive ? "text-white" : "text-on-surface"
                    }`}
                  >
                    {row.subtheme}
                  </span>
                  <span
                    className={`text-xs font-bold shrink-0 ${
                      isActive ? "text-white/90" : "text-on-surface-variant"
                    }`}
                  >
                    {row.percentage}%
                  </span>
                </div>
                <div
                  className="h-1.5 w-full rounded-full overflow-hidden"
                  style={{
                    backgroundColor: isActive
                      ? "rgba(255,255,255,0.2)"
                      : "#e7e8e9",
                  }}
                >
                  <motion.div
                    className="h-full rounded-full"
                    initial={{ width: 0 }}
                    animate={{
                      width: `${row.percentage > 0 ? Math.max(2, Math.min(100, row.percentage)) : 0}%`,
                    }}
                    transition={{
                      duration: 0.6,
                      delay: idx * 0.06 + 0.2,
                      ease: [0.16, 1, 0.3, 1],
                    }}
                    style={{ background: isActive ? "#ffffff" : gradient }}
                  />
                </div>
                <div
                  className={`flex justify-between items-center w-full text-[10px] ${
                    isActive
                      ? "text-white/80"
                      : "text-on-surface-variant/85 font-medium"
                  }`}
                >
                  <span>{t("overview.card.comments", { n: row.quote_count ?? row.mentions })}</span>
                  <span className="flex items-center gap-0.5 uppercase tracking-wider font-semibold">
                    {t("detail.breakdown.action")}{" "}
                    <span className="material-symbols-outlined text-[10px]">
                      chevron_right
                    </span>
                  </span>
                </div>
              </motion.button>
            );
          })}
        </div>
      ) : (
        <p className="text-sm text-on-surface-variant">
          {t("detail.subthemes.empty")}
        </p>
      )}
    </motion.div>
  );
}

// ── Quick stats row ─────────────────────────────────────────────────────────
function QuickStats({ activeData, accentColor }) {
  const { t } = useI18n();
  const totalComments = activeData.quotes?.length ?? 0;
  const subthemeCount =
    activeData.subtheme_mentions?.length || activeData.subthemes?.length || 0;
  const suggestionCount = activeData.student_suggestions?.length || 0;

  const stats = [
    { icon: "forum", value: totalComments, label: t("overview.stat.comments") },
    { icon: "layers", value: subthemeCount, label: t("overview.stat.subthemes") },
    { icon: "lightbulb", value: suggestionCount, label: t("detail.stat.suggestions") },
  ];

  return (
    <div className="grid grid-cols-3 gap-3">
      {stats.map((stat, idx) => (
        <motion.div
          key={stat.label}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{
            duration: 0.4,
            delay: 0.3 + idx * 0.08,
            ease: [0.16, 1, 0.3, 1],
          }}
          className="bg-surface-container-lowest rounded-xl p-4 border border-outline-variant/10 shadow-sm flex flex-col items-center gap-1"
        >
          <span
            className="material-symbols-outlined text-lg"
            style={{ color: accentColor, fontVariationSettings: "'FILL' 1" }}
          >
            {stat.icon}
          </span>
          <span className="text-xl font-extrabold font-headline text-on-surface tabular-nums">
            {stat.value}
          </span>
          <span className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant/60">
            {stat.label}
          </span>
        </motion.div>
      ))}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// MAIN PAGE
// ══════════════════════════════════════════════════════════════════════════════
export default function ViewMorePage() {
  const { t } = useI18n();
  const { id, subthemeName } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const decodedSubtheme = useMemo(() => {
    return subthemeName ? decodeURIComponent(subthemeName) : null;
  }, [subthemeName]);

  const filters = useMemo(() => {
    const urlFilters = filtersFromSearchParams(searchParams);
    if (!filtersHaveActiveValues(urlFilters) && location.state?.filters) {
      return normalizeFilters(location.state.filters);
    }
    return urlFilters;
  }, [searchParams, location.state]);

  const [filterOptions, setFilterOptions] = useState({
    academic_years: [],
    programmes: [],
    study_modes: [],
    languages: [],
  });

  useEffect(() => {
    fetch(apiUrl("/api/filter-options"))
      .then((r) => r.json())
      .then((data) => {
        if (data.status === "success") setFilterOptions(data.options);
      })
      .catch(() => {});
  }, []);

  const [availableFilterOptions, setAvailableFilterOptions] = useState(null);
  useEffect(() => {
    const apiFilters = filtersToApiParams(filters);
    if (Object.keys(apiFilters).length === 0) {
      setAvailableFilterOptions(null);
      return;
    }
    const params = new URLSearchParams(apiFilters);
    fetch(apiUrl(`/api/filter-options?${params}`))
      .then((r) => r.json())
      .then((data) => { if (data.status === "success") setAvailableFilterOptions(data.options); })
      .catch(() => {});
  }, [filters]);

  function setFilter(key, value) {
    const nextFilters = normalizeFilters({ ...filters, [key]: value });
    setSearchParams(filtersToSearchParams(nextFilters));
  }

  function clearFilters() {
    setSearchParams(new URLSearchParams());
  }

  const hasActiveFilters = filtersHaveActiveValues(filters);

  const routeTheme =
    location.state?.theme?.id === id ? location.state.theme : null;

  const fetchedTheme = useMemo(() => {
    if (routeTheme) return null;
    const themeName = THEME_NAME_BY_ID[id];
    if (!themeName) return null;
    return buildRealTheme(themeName, {}, { includeInsightDetails: false });
  }, [id, routeTheme]);

  const loadingTheme = false;

  const theme = routeTheme || fetchedTheme;
  const colors = theme ? getThemeColor(theme.id) : getThemeColor("content_org");
  const filterSearch = searchFromFilters(filters);
  const { liveData, loadingLive } = useThemeSummary(theme, filters);

  const [subthemeLiveData, setSubthemeLiveData] = useState(null);
  const [loadingSubtheme, setLoadingSubtheme] = useState(false);

  useEffect(() => {
    if (!decodedSubtheme || !theme) {
      setSubthemeLiveData(null);
      return;
    }

    let isMounted = true;
    setLoadingSubtheme(true);
    setSubthemeLiveData(null);
    const apiFilters = filtersToApiParams(filters);
    fetch(apiUrl("/api/theme-summary"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        theme: theme.name,
        query: decodedSubtheme,
        filters: Object.keys(apiFilters).length > 0 ? apiFilters : undefined,
        allow_model_download: true,
      }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (!isMounted) return;
        if (data.status === "success") {
          setSubthemeLiveData(data);
        } else if (data.status === "not_cached") {
          setSubthemeLiveData({ not_cached: true, message: data.message });
        }
      })
      .catch(() => {})
      .finally(() => {
        if (isMounted) setLoadingSubtheme(false);
      });
    return () => {
      isMounted = false;
    };
  }, [decodedSubtheme, theme?.id, theme?.name, JSON.stringify(filters)]);

  // If live generation fails/offline, use the real payload already loaded for this theme.
  const hasLlmError =
    !liveData || liveData.error || liveData.status === "error";
  const effectiveData = hasLlmError ? theme?.cachedInsight || theme : liveData;

  // Drilldown data logic: checks if subthemeName is present in params
  const activeData = useMemo(() => {
    if (!theme) return null;

    const cached = effectiveData || theme;

    if (decodedSubtheme && subthemeLiveData) {
      // Only show the number of comments actually linked to this sub-theme
      // (its mention count), not every comment the parent theme retrieved.
      const mentionCount = theme.subtheme_mentions?.find(
        (sm) => sm.subtheme === decodedSubtheme,
      )?.mentions;
      const subthemeQuotes = subthemeLiveData.quotes || [];
      const linkedQuotes =
        typeof mentionCount === "number" &&
        mentionCount > 0 &&
        mentionCount < subthemeQuotes.length
          ? subthemeQuotes.slice(0, mentionCount)
          : subthemeQuotes;

      return {
        isSubtheme: true,
        name: decodedSubtheme,
        summary: subthemeLiveData.summary,
        subthemes: subthemeLiveData.subthemes || [],
        subtheme_mentions: subthemeLiveData.subtheme_mentions || [],
        quotes: linkedQuotes,
        student_suggestions: subthemeLiveData.student_suggestions || [],
        positive_comments: subthemeLiveData.positive_comments || [],
        critical_comments: subthemeLiveData.critical_comments || [],
      };
    }

    if (decodedSubtheme && (!subthemeLiveData || subthemeLiveData.not_cached)) {
      return {
        isSubtheme: true,
        name: decodedSubtheme,
        summary: null,
        not_cached: subthemeLiveData?.not_cached ?? false,
        subthemes: [],
        subtheme_mentions: [],
        quotes: [],
        student_suggestions: [],
        positive_comments: [],
        critical_comments: [],
      };
    }

    const comments =
      cached.quotes?.length > 0 ? cached.quotes : (theme.quotes ?? []);
    const subthemes =
      cached.subthemes?.length > 0 ? cached.subthemes : (theme.subthemes ?? []);
    const studentSuggestions =
      cached.student_suggestions?.length > 0 ? cached.student_suggestions : [];

    const chartRows = buildSubthemeRows(subthemes, cached.subtheme_mentions, [
      ...comments,
      ...studentSuggestions,
    ]);

    return {
      isSubtheme: false,
      name: theme.name,
      summary: cached.summary || theme.aiSummary,
      subthemes: subthemes,
      subtheme_mentions: chartRows,
      quotes: comments,
      displayCommentCount:
        theme.responseCount ?? theme.percentage ?? comments.length,
      student_suggestions: studentSuggestions,
      positive_comments:
        cached.positive_comments?.length > 0 ? cached.positive_comments : [],
      critical_comments:
        cached.critical_comments?.length > 0 ? cached.critical_comments : [],
    };
  }, [theme, effectiveData, decodedSubtheme, subthemeLiveData]);

  const displayedComments = useMemo(
    () => activeData?.quotes || [],
    [activeData?.quotes],
  );

  if (loadingTheme) {
    return (
      <main className="max-w-[1280px] mx-auto px-4 py-6 md:px-8 md:py-10">
        <p className="text-on-surface-variant">{t("overview.loading")}</p>
      </main>
    );
  }

  if (!theme) {
    return (
      <main className="max-w-[1280px] mx-auto px-4 py-6 md:px-8 md:py-10">
        <p className="text-on-surface-variant">
          {t("detail.notFound")}
        </p>
        <NavLink
          to="/"
          className="text-sm text-primary font-semibold mt-4 inline-block"
        >
          {t("detail.backOverview")}
        </NavLink>
      </main>
    );
  }

  return (
    <main className="bg-surface min-h-[calc(100svh-64px)] font-sans">
      <div className="max-w-[1280px] mx-auto px-4 py-6 md:px-8 md:py-10">
        {/* Breadcrumb Navigation */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.4 }}
          className="flex flex-wrap items-center gap-1 text-sm font-semibold text-on-surface-variant/70 mb-6"
        >
          <Link
            to={{ pathname: "/", search: filterSearch }}
            className="hover:text-on-surface transition-colors flex items-center gap-1 no-underline text-on-surface-variant/70"
          >
            <span className="material-symbols-outlined text-base">home</span>
            {t("nav.overview")}
          </Link>
          <span className="material-symbols-outlined text-xs text-outline select-none">
            chevron_right
          </span>
          {decodedSubtheme ? (
            <>
              <button
                onClick={() =>
                  navigate(
                    { pathname: `/thema/${theme.id}`, search: filterSearch },
                    { state: { theme, filters } },
                  )
                }
                className="hover:text-on-surface transition-colors focus:outline-none bg-transparent border-none p-0 cursor-pointer font-semibold text-on-surface-variant/70"
              >
                {themeLabel(t, theme.name)}
              </button>
              <span className="material-symbols-outlined text-xs text-outline select-none">
                chevron_right
              </span>
              <span className="font-bold" style={{ color: colors.accent }}>
                {decodedSubtheme}
              </span>
            </>
          ) : (
            <span className="font-bold" style={{ color: colors.accent }}>
              {themeLabel(t, theme.name)}
            </span>
          )}
        </motion.div>

        {/* Filters bar */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1, duration: 0.4 }}
          className="relative z-20 bg-surface-container-lowest/85 glass-panel shadow-editorial rounded-2xl px-5 py-4 mb-6"
        >
          <div className="flex flex-wrap md:flex-nowrap gap-3 flex-1">
            <div className="flex-1 min-w-[130px]">
              <FilterDropdown
                icon="calendar_today"
                label={t("overview.f.year")}
                value={filters.jaar}
                options={["All", ...filterOptions.academic_years]}
                availableOptions={availableFilterOptions ? ["All", ...availableFilterOptions.academic_years] : null}
                onChange={(v) => setFilter("jaar", v)}
              />
            </div>
            <div className="flex-1 min-w-[130px]">
              <FilterDropdown
                icon="location_on"
                label={t("overview.f.location")}
                value={filters.locatie}
                options={LOCATION_OPTIONS}
                availableOptions={availableFilterOptions ? ["All", ...availableFilterOptions.locations] : null}
                onChange={(v) => setFilter("locatie", v)}
              />
            </div>
            <div className="flex-1 min-w-[130px]">
              <FilterDropdown
                icon="school"
                label={t("overview.f.programme")}
                value={filters.opleiding}
                options={["All", ...filterOptions.programmes]}
                availableOptions={availableFilterOptions ? ["All", ...availableFilterOptions.programmes] : null}
                onChange={(v) => setFilter("opleiding", v)}
              />
            </div>
            <div className="flex-1 min-w-[130px]">
              <FilterDropdown
                icon="history_edu"
                label={t("overview.f.studyMode")}
                value={filters.studievorm}
                options={["All", ...filterOptions.study_modes]}
                availableOptions={availableFilterOptions ? ["All", ...availableFilterOptions.study_modes] : null}
                onChange={(v) => setFilter("studievorm", v)}
              />
            </div>
            <div className="flex-1 min-w-[130px]">
              <FilterDropdown
                icon="translate"
                label={t("overview.f.language")}
                value={filters.taal}
                options={["All", ...filterOptions.languages]}
                availableOptions={availableFilterOptions ? ["All", ...availableFilterOptions.languages] : null}
                onChange={(v) => setFilter("taal", v)}
              />
            </div>
          </div>
          {hasActiveFilters && (
            <button
              onClick={clearFilters}
              className="mt-3 flex items-center gap-1.5 text-xs font-semibold text-on-surface-variant hover:text-primary transition-colors border-none bg-transparent cursor-pointer"
            >
              <span className="material-symbols-outlined text-sm">
                filter_alt_off
              </span>
              {t("overview.clearFilters")}
            </button>
          )}
        </motion.div>

        {/* ── Theme Header ── */}
        <motion.section
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
          className="relative rounded-2xl overflow-hidden shadow-editorial border border-outline-variant/10 text-white"
          style={{ background: colors.gradient }}
        >
          {/* Decorative dot pattern */}
          <div
            className="absolute inset-0 opacity-[0.06]"
            style={{
              backgroundImage:
                "radial-gradient(circle at 1px 1px, white 1px, transparent 0)",
              backgroundSize: "20px 20px",
            }}
          />
          {/* Decorative glow */}
          <div
            className="absolute -top-16 -right-16 w-48 h-48 rounded-full opacity-20"
            style={{
              background:
                "radial-gradient(circle, rgba(255,255,255,0.4) 0%, transparent 70%)",
            }}
          />

          <div className="relative z-10 p-5 md:p-8">
            <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-6">
              <div className="flex items-start gap-4">
                <span
                  className="material-symbols-outlined text-4xl md:text-5xl shrink-0 text-white/90"
                  style={{ fontVariationSettings: "'FILL' 1" }}
                >
                  {theme.icon}
                </span>
                <div>
                  <p className="text-xs font-bold uppercase tracking-wider text-white/60 mb-1">
                    {activeData.isSubtheme
                      ? t("detail.subthemeOf", { theme: themeLabel(t, theme.name) })
                      : t("detail.themeDetail")}
                  </p>
                  <h1 className="text-2xl md:text-4xl font-bold font-headline leading-tight">
                    {activeData.isSubtheme ? activeData.name : themeLabel(t, activeData.name)}
                  </h1>
                  {!activeData.isSubtheme && themeText(t, theme.name, "subtag", theme.subtag) && (
                    <p className="text-sm text-white/70 mt-2">{themeText(t, theme.name, "subtag", theme.subtag)}</p>
                  )}
                  {!activeData.isSubtheme && themeText(t, theme.name, "desc", theme.description) && (
                    <p className="text-sm text-white/70 mt-1">
                      {themeText(t, theme.name, "desc", theme.description)}
                    </p>
                  )}
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                {(loadingLive || loadingSubtheme) && (
                  <span className="flex items-center gap-1.5 text-xs font-semibold text-white/80">
                    <span className="w-2 h-2 rounded-full bg-white/80 animate-pulse" />
                    {t("detail.loading")}
                  </span>
                )}
              </div>
            </div>
          </div>
        </motion.section>

        {/* ── Quick Stats ── */}
        <div className="mt-6">
          <QuickStats activeData={activeData} accentColor={colors.accent} />
        </div>

        {/* ── Main Content Grid ── */}
        <section className="grid grid-cols-1 lg:grid-cols-12 gap-5 md:gap-6 mt-6">
          <div className="lg:col-span-8 space-y-5">
            {activeData.isSubtheme ? (
              activeData.not_cached ? (
                <div className="rounded-2xl border border-amber-200 bg-amber-50 p-8 text-center">
                  <span
                    className="material-symbols-outlined text-amber-500 text-4xl mb-3 block"
                    style={{ fontVariationSettings: "'FILL' 1" }}
                  >
                    hourglass_empty
                  </span>
                  <p className="text-sm font-bold text-amber-900">
                    {t("detail.notCached.title")}
                  </p>
                  <p className="text-xs text-amber-700 mt-1">
                    {t("detail.notCached.body")}
                  </p>
                </div>
              ) : (
                <AIFeedbackBento
                  positivePoints={activeData.positive_comments}
                  negativePoints={activeData.critical_comments}
                  comments={activeData.quotes}
                  accentColor={colors.accent}
                  loading={loadingLive || loadingSubtheme}
                />
              )
            ) : (
              <AIFeedbackBento
                positivePoints={activeData.positive_comments}
                negativePoints={activeData.critical_comments}
                comments={activeData.quotes}
                accentColor={colors.accent}
                loading={loadingLive}
              />
            )}

            <SuggestionSection
              suggestions={activeData.student_suggestions}
              accentColor={colors.accent}
            />

            {/* Scrollable Comments Grid */}
            {displayedComments.length > 0 && (
              <motion.div
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{
                  duration: 0.5,
                  delay: 0.3,
                  ease: [0.16, 1, 0.3, 1],
                }}
                className="bg-surface-container-lowest rounded-2xl p-4 md:p-6 shadow-sm border border-outline-variant/10"
              >
                <div className="flex items-center justify-between gap-3 mb-4">
                  <div className="flex flex-col">
                    <h2 className="text-base md:text-lg font-bold font-headline text-on-surface">
                      {t("detail.retrieved.title")}
                    </h2>
                    <p className="text-xs text-on-surface-variant/60 mt-0.5">
                      {t(activeData.isSubtheme ? "detail.retrieved.sub" : "detail.retrieved.main", { n: displayedComments.length })}
                    </p>
                  </div>
                  <span
                    className="text-sm font-bold font-headline"
                    style={{ color: `${colors.accent}` }}
                  >
                    {displayedComments.length}
                  </span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-h-[500px] overflow-y-auto pr-2 custom-scrollbar">
                  {displayedComments.map((comment, i) => (
                    <CommentCard
                      key={i}
                      comment={comment}
                      accentColor={colors.accent}
                      index={i}
                    />
                  ))}
                </div>
                <p className="text-[10px] text-on-surface-variant/50 italic mt-4">
                  {t("detail.retrieved.note")}
                </p>
              </motion.div>
            )}
          </div>

          {/* ── Sidebar ── */}
          <aside className="lg:col-span-4">
            <div className="space-y-5 lg:sticky lg:top-24">
              {/* SVG Donut Chart */}
              <DonutChart
                rows={activeData.subtheme_mentions}
                title={
                  activeData.isSubtheme
                    ? t("detail.donut.sub")
                    : t("detail.donut.main")
                }
                accentColor={colors.accent}
              />

              {/* List of subthemes as buttons */}
              {!activeData.isSubtheme ? (
                <SubthemesList
                  rows={activeData.subtheme_mentions}
                  onSelectSubtheme={(subName) =>
                    navigate(
                      {
                        pathname: `/thema/${theme.id}/subtheme/${encodeURIComponent(subName)}`,
                        search: filterSearch,
                      },
                      { state: { theme, filters } },
                    )
                  }
                  activeSubtheme={decodedSubtheme}
                  accentColor={colors.accent}
                  gradient={colors.gradient}
                />
              ) : (
                <div className="space-y-5">
                  {/* List of other subthemes to easily switch from subtheme page */}
                  <motion.div
                    initial={{ opacity: 0, y: 16 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.5, delay: 0.2 }}
                    className="bg-surface-container-lowest rounded-2xl p-4 md:p-6 shadow-sm border border-outline-variant/10"
                  >
                    <h3 className="text-xs font-bold uppercase tracking-wider text-on-surface-variant mb-4">
                      {t("detail.other")}
                    </h3>
                    <div className="flex flex-col gap-2.5">
                      {theme.subtheme_mentions
                        ?.filter((sm) => sm.subtheme !== decodedSubtheme)
                        .map((sm) => (
                          <button
                            key={sm.subtheme}
                            onClick={() =>
                              navigate(
                                {
                                  pathname: `/thema/${theme.id}/subtheme/${encodeURIComponent(sm.subtheme)}`,
                                  search: filterSearch,
                                },
                                { state: { theme, filters } },
                              )
                            }
                            className="w-full text-left p-3.5 rounded-xl border border-outline-variant/10 bg-surface-container-low hover:bg-surface-container-high text-sm font-bold text-on-surface transition-all duration-200 hover:scale-[1.01] cursor-pointer"
                          >
                            <div className="flex justify-between items-center w-full gap-2">
                              <span className="truncate">{sm.subtheme}</span>
                              <span
                                className="text-xs font-bold shrink-0"
                                style={{ color: colors.accent }}
                              >
                                {sm.percentage}%
                              </span>
                            </div>
                          </button>
                        ))}
                    </div>
                  </motion.div>
                </div>
              )}

              {activeData.isSubtheme ? (
                <div className="flex gap-3">
                  <Link
                    to={{ pathname: "/", search: filterSearch }}
                    className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl text-white text-xs font-bold px-3 py-3 transition-all shadow-sm no-underline hover:opacity-90"
                    style={{ background: colors.gradient }}
                  >
                    <span className="material-symbols-outlined text-base">
                      dashboard
                    </span>
                    {t("detail.backDashboard")}
                  </Link>
                  <button
                    onClick={() =>
                      navigate(
                        {
                          pathname: `/thema/${theme.id}`,
                          search: filterSearch,
                        },
                        { state: { theme, filters } },
                      )
                    }
                    className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl border text-xs font-bold px-3 py-3 transition-colors cursor-pointer hover:opacity-80 bg-transparent"
                    style={{ borderColor: colors.accent, color: colors.accent }}
                  >
                    <span className="material-symbols-outlined text-base">
                      arrow_upward
                    </span>
                    {t("detail.backTheme")}
                  </button>
                </div>
              ) : (
                <Link
                  to={{ pathname: "/", search: filterSearch }}
                  className="inline-flex items-center justify-center gap-2 w-full rounded-xl text-white text-sm font-bold px-4 py-3 transition-all shadow-sm no-underline hover:opacity-90"
                  style={{ background: colors.gradient }}
                >
                  <span className="material-symbols-outlined text-base">
                    dashboard
                  </span>
                  {t("detail.backDashboard")}
                </Link>
              )}
            </div>
          </aside>
        </section>
      </div>
    </main>
  );
}
