"use client";

import { useState, type FormEvent } from "react";
import { track } from "@/lib/analytics";

const worthOptions = [
  { value: "0-9.99", label: "$0-$9.99" },
  { value: "10-19.99", label: "$10-$19.99" },
  { value: "20-29.99", label: "$20-$29.99" },
  { value: "30-39.99", label: "$30-$39.99" },
  { value: "40+", label: "$40+" },
] as const;

const worthValue = (range: string) => {
  if (range === "0-9.99") return 0;
  if (range === "10-19.99") return 9.99;
  if (range === "20-29.99") return 19.99;
  if (range === "30-39.99") return 29.99;
  return 39.99;
};

type Props = {
  onCompleted?: () => void;
};

export default function PreCheckoutFeedback({ onCompleted }: Props) {
  const [rating, setRating] = useState(0);
  const [category, setCategory] = useState("clarity");
  const [suggestions, setSuggestions] = useState("");
  const [worth, setWorth] = useState("");
  const [sent, setSent] = useState(false);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!rating || !worth) return;
    track({
      category,
      comment: JSON.stringify({
        category,
        comment: suggestions.trim(),
        phase: "pre-checkout",
        rating,
        scanQuality: rating,
        service: rating,
        ui: rating,
        worth: worthValue(worth),
        worthRange: worth,
      }),
      event: "feedback_submitted",
      value: rating,
    });
    setSent(true);
    onCompleted?.();
  };

  return (
    <section className="feedback-card pre-checkout-feedback-card" aria-labelledby="pre-checkout-feedback-title">
      <div>
        <span className="kicker">HELP US IMPROVE THE BETA</span>
        <strong id="pre-checkout-feedback-title">Was this preview clear and useful?</strong>
        <p>This short survey appears before checkout. No quote, name, VIN, or payment details are collected.</p>
      </div>
      {sent ? (
        <p className="feedback-thanks" role="status">Thanks - your feedback was recorded.</p>
      ) : (
        <form onSubmit={submit}>
          <div className="feedback-rating" aria-label="Rate the preview">
            {[1, 2, 3, 4, 5].map((value) => (
              <button
                aria-label={`${value} out of 5`}
                className={value <= rating ? "selected" : ""}
                key={value}
                onClick={() => setRating(value)}
                type="button"
              >★</button>
            ))}
          </div>
          <label>
            <span>What would you improve?</span>
            <select value={category} onChange={(event) => setCategory(event.target.value)}>
              <option value="clarity">The result was confusing</option>
              <option value="import">The numbers were imported incorrectly</option>
              <option value="manual">Manual entry needs work</option>
              <option value="trust">I had a trust or privacy concern</option>
              <option value="other">Something else</option>
            </select>
          </label>
          <label>
            <span>Suggestions</span>
            <textarea maxLength={1000} value={suggestions} onChange={(event) => setSuggestions(event.target.value)} placeholder="Tell us what happened..." />
          </label>
          <fieldset className="feedback-worth-fieldset">
            <legend>How much would this service be worth to you?</legend>
            <div className="feedback-worth-grid">
              {worthOptions.map((option) => (
                <label className="feedback-worth-option" key={option.value}>
                  <input type="radio" name="pre-checkout-feedback-worth" value={option.value} checked={worth === option.value} onChange={() => setWorth(option.value)} />
                  <span>{option.label}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <button className="button button-quiet" type="submit" disabled={!rating || !worth}>Send feedback</button>
        </form>
      )}
    </section>
  );
}
