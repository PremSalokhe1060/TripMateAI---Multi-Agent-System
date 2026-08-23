let currentThreadId = localStorage.getItem("travel_thread_id") || null;
let latestAnswerMarkdown = "";
let waitingForApproval = false;

const AGENT_LABELS = {
    flight_agent: "✈ Flight Agent",
    hotel_agent: "🏨 Hotel Agent",
    weather_agent: "☁ Weather Agent",
    budget_agent: "💰 Budget Agent",
    itinerary_agent: "🗓 Itinerary Agent"
};

function $(id) {
    return document.getElementById(id);
}

function setPrompt(text) {
    const el = $("userInput");
    if (el) el.value = text;
}

function setLoading(isLoading, mode = "draft") {
    const sendBtn = $("sendBtn");
    const btnText = $("btnText");
    const btnLoader = $("btnLoader");
    const approveBtn = $("approveBtn");
    const reviseBtn = $("reviseBtn");

    if (sendBtn) sendBtn.disabled = isLoading;
    if (approveBtn) approveBtn.disabled = isLoading;
    if (reviseBtn) reviseBtn.disabled = isLoading;

    if (mode === "draft") {
        if (btnText) btnText.classList.toggle("hidden", isLoading);
        if (btnLoader) btnLoader.classList.toggle("hidden", !isLoading);
    }
}

function showError(message) {
    const errorBox = $("errorBox");
    if (!errorBox) {
        alert(message);
        return;
    }
    errorBox.textContent = message;
    errorBox.classList.remove("hidden");
    errorBox.scrollIntoView({ behavior: "smooth", block: "center" });
}

function hideError() {
    const errorBox = $("errorBox");
    if (!errorBox) return;
    errorBox.classList.add("hidden");
    errorBox.textContent = "";
}

function renderMarkdown(element, markdown) {
    if (!element) return;
    if (typeof marked !== "undefined") {
        element.innerHTML = marked.parse(markdown || "");
    } else {
        element.innerText = markdown || "";
    }
}

// Renders the supervisor's routing plan: which specialist agents it chose,
// its reasoning, and whether the input guardrail passed. Called on EVERY
// successful response (both the initial draft and the resumed final run),
// which is why it always shows up rather than only during approval.
function showWorkflow(data) {
    const section = $("workflowSection");
    const reasoning = $("supervisorReasoning");
    const chips = $("agentChips");
    const guardrailBadge = $("guardrailBadge");

    if (!section) {
        console.warn("[TripMate] #workflowSection missing from DOM.");
        return;
    }

    if (reasoning) {
        reasoning.textContent =
            data.supervisor_reasoning || "Supervisor routing completed.";
    }

    if (chips) {
        chips.innerHTML = "";
        const agents = Array.isArray(data.selected_agents) ? data.selected_agents : [];

        agents.forEach((agent) => {
            const chip = document.createElement("span");
            chip.className = "agent-chip";
            chip.textContent = AGENT_LABELS[agent] || agent;
            chips.appendChild(chip);
        });
    }

    if (guardrailBadge) {
        if (data.guardrail_allowed === false) {
            guardrailBadge.textContent = "Guardrail blocked";
            guardrailBadge.classList.add("blocked");
        } else {
            guardrailBadge.textContent = "Guardrail passed";
            guardrailBadge.classList.remove("blocked");
        }
    }

    section.classList.remove("hidden");
}

function showResult(answer, threadId, isDraft = false) {
    latestAnswerMarkdown = answer || "";

    const resultSection = $("resultSection");
    const resultBox = $("resultBox");
    const threadInfo = $("threadInfo");
    const resultTitle = $("resultTitle");

    renderMarkdown(resultBox, latestAnswerMarkdown);

    if (threadInfo) threadInfo.textContent = `Thread ID: ${threadId || "-"}`;
    if (resultTitle) {
        resultTitle.textContent = isDraft ? "Draft Travel Plan" : "Your Final AI Travel Plan";
    }

    if (resultSection) {
        resultSection.classList.remove("hidden");
        resultSection.scrollIntoView({ behavior: "smooth", block: "start" });
    }
}

// Shown alongside resultSection (which is displaying the draft) whenever
// the backend pauses the LangGraph thread at the human_approval interrupt
// and returns requires_approval:true.
function showApproval(data) {
    waitingForApproval = true;

    const section = $("approvalSection");
    const approvalRequest = $("approvalRequest");

    if (approvalRequest) {
        approvalRequest.textContent =
            data.approval_request ||
            "Approve the draft or provide feedback before the final plan is generated.";
    }

    if (section) section.classList.remove("hidden");
}

function hideApproval() {
    waitingForApproval = false;

    const section = $("approvalSection");
    const feedback = $("approvalFeedback");

    if (section) section.classList.add("hidden");
    if (feedback) feedback.value = "";
}

async function sendMessage() {
    hideError();

    if (waitingForApproval) {
        showError("Please approve or revise the current draft before starting another plan.");
        return;
    }

    const input = $("userInput");
    const message = input ? input.value.trim() : "";

    if (!message) {
        showError("Please enter your travel request first.");
        return;
    }

    setLoading(true, "draft");

    try {
        const response = await fetch("/api/travel", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                message: message,
                thread_id: currentThreadId
            })
        });

        const data = await response.json();
        console.log("[TripMate] /api/travel response:", data);

        if (!response.ok || !data.success) {
            throw new Error(data.error || "Something went wrong.");
        }

        currentThreadId = data.thread_id;
        localStorage.setItem("travel_thread_id", currentThreadId);

        // Always render the supervisor's plan, whether or not human review
        // is required.
        showWorkflow(data);

        if (data.requires_approval) {
            showResult(data.itinerary || data.answer, data.thread_id, true);
            showApproval(data);
        } else {
            hideApproval();
            showResult(data.answer, data.thread_id, false);
        }

    } catch (error) {
        console.error("[TripMate] sendMessage error:", error);
        showError(error.message);
    } finally {
        setLoading(false, "draft");
    }
}

// Approves or requests revisions on the paused draft itinerary by calling
// POST /api/travel/approve, which resumes the LangGraph thread. The
// backend's human_approval -> final_agent edge always runs straight to the
// final polished answer, so there's no second approval round to handle.
async function submitApproval(approved) {
    hideError();

    if (!currentThreadId || !waitingForApproval) {
        showError("There is no draft waiting for approval.");
        return;
    }

    const feedbackInput = $("approvalFeedback");
    const feedback = feedbackInput ? feedbackInput.value.trim() : "";

    if (!approved && !feedback) {
        showError("Please enter revision feedback before requesting changes.");
        if (feedbackInput) feedbackInput.focus();
        return;
    }

    setLoading(true, "approval");

    try {
        const response = await fetch("/api/travel/approve", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                thread_id: currentThreadId,
                approved: approved,
                feedback: feedback
            })
        });

        const data = await response.json();
        console.log("[TripMate] /api/travel/approve response:", data);

        if (!response.ok || !data.success) {
            throw new Error(data.error || "Could not resume the travel workflow.");
        }

        showWorkflow(data);
        hideApproval();
        showResult(data.answer, data.thread_id, false);

    } catch (error) {
        console.error("[TripMate] submitApproval error:", error);
        showError(error.message);
    } finally {
        setLoading(false, "approval");
    }
}

function copyResult() {
    const resultBox = $("resultBox");
    const text = resultBox ? resultBox.innerText : "";

    if (!text) return;

    navigator.clipboard.writeText(text)
        .then(() => {
            const copyBtn = document.querySelector(".copy-btn");
            if (!copyBtn) return;
            const oldText = copyBtn.textContent;
            copyBtn.textContent = "Copied!";
            setTimeout(() => { copyBtn.textContent = oldText; }, 1400);
        })
        .catch(() => showError("Could not copy result."));
}

function downloadPDF() {
    const pdfContent = $("pdfContent");

    if (!latestAnswerMarkdown || !pdfContent) {
        showError("No travel plan available to download.");
        return;
    }

    const downloadBtn = document.querySelector(".download-btn");
    const oldText = downloadBtn ? downloadBtn.textContent : "";

    if (downloadBtn) {
        downloadBtn.textContent = "Preparing PDF...";
        downloadBtn.disabled = true;
    }

    const options = {
        margin: 0.5,
        filename: "ai-travel-plan.pdf",
        image: { type: "jpeg", quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true, backgroundColor: "#ffffff" },
        jsPDF: { unit: "in", format: "a4", orientation: "portrait" },
        pagebreak: { mode: ["avoid-all", "css", "legacy"] }
    };

    html2pdf()
        .set(options)
        .from(pdfContent)
        .save()
        .then(() => {
            if (downloadBtn) {
                downloadBtn.textContent = oldText;
                downloadBtn.disabled = false;
            }
        })
        .catch(() => {
            if (downloadBtn) {
                downloadBtn.textContent = oldText;
                downloadBtn.disabled = false;
            }
            showError("Could not download PDF.");
        });
}

document.addEventListener("keydown", function(event) {
    if (event.ctrlKey && event.key === "Enter") {
        sendMessage();
    }
});

console.log("[TripMate] script.js loaded — supervisor workflow + HITL build.");