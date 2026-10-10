import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { OutcomeBar, Pagination, PriorityBadge } from "../components/ui";

describe("PriorityBadge", () => {
  it("shows the band as a word and the score, not colour alone", () => {
    render(<PriorityBadge band="high" score={0.826} />);
    expect(screen.getByText("High")).toBeInTheDocument();
    expect(screen.getByText("83%")).toBeInTheDocument();
  });
});

describe("OutcomeBar", () => {
  it("describes the mix in text for screen readers", () => {
    render(<OutcomeBar tp={1} bp={2} fp={1} />);
    expect(screen.getByRole("img")).toHaveAccessibleName(
      "True positive 25%, Benign positive 50%, False positive 25%",
    );
  });

  it("says so when nothing has been graded", () => {
    render(<OutcomeBar tp={0} bp={0} fp={0} />);
    expect(screen.getByText("No graded incidents")).toBeInTheDocument();
  });
});

describe("Pagination", () => {
  it("shows the range and disables Previous on the first page", async () => {
    const onPage = vi.fn();
    render(<Pagination page={1} pageSize={25} total={753} onPage={onPage} />);
    expect(screen.getByText("1–25 of 753")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(onPage).toHaveBeenCalledWith(2);
  });

  it("disables Next on the last page", () => {
    render(<Pagination page={31} pageSize={25} total={753} onPage={() => {}} />);
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
    expect(screen.getByText("751–753 of 753")).toBeInTheDocument();
  });
});
