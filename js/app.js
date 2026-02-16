// ============================================
// App — Main Controller
// ============================================

(async function () {
  // ---- DOM refs ----
  const authScreen = document.getElementById("auth-screen");
  const dashScreen = document.getElementById("dashboard-screen");
  const loginForm = document.getElementById("login-form");
  const registerForm = document.getElementById("register-form");
  const userName = document.getElementById("user-name");
  const addFormBody = document.getElementById("add-form-body");
  const toggleIcon = document.getElementById("toggle-icon");
  const questionsList = document.getElementById("questions-list");
  const questionCount = document.getElementById("question-count");
  const searchInput = document.getElementById("search-input");
  const filterDifficulty = document.getElementById("filter-difficulty");
  const formMsg = document.getElementById("form-msg");
  const modalOverlay = document.getElementById("modal-overlay");

  let allQuestions = [];
  let unsubQuestions = null;
  let deleteTargetId = null;

  // ---- Init Firebase ----
  await initFirebase();

  // ---- Auth state ----
  Auth.onAuthChanged(user => {
    if (user) {
      showDashboard(user);
    } else {
      showAuth();
    }
  });

  // ---- Auth: toggle forms ----
  document.getElementById("show-register").addEventListener("click", e => {
    e.preventDefault();
    loginForm.classList.add("hidden");
    registerForm.classList.remove("hidden");
  });
  document.getElementById("show-login").addEventListener("click", e => {
    e.preventDefault();
    registerForm.classList.add("hidden");
    loginForm.classList.remove("hidden");
  });

  // ---- Auth: login ----
  document.getElementById("btn-login").addEventListener("click", async () => {
    const email = document.getElementById("login-email").value;
    const pass = document.getElementById("login-password").value;
    const btn = document.getElementById("btn-login");
    btn.disabled = true;
    btn.textContent = "Signing in...";
    await Auth.loginWithEmail(email, pass);
    btn.disabled = false;
    btn.textContent = "Sign In";
  });

  // ---- Auth: register ----
  document.getElementById("btn-register").addEventListener("click", async () => {
    const name = document.getElementById("reg-name").value;
    const email = document.getElementById("reg-email").value;
    const pass = document.getElementById("reg-password").value;
    const btn = document.getElementById("btn-register");
    btn.disabled = true;
    btn.textContent = "Creating account...";
    await Auth.registerWithEmail(name, email, pass);
    btn.disabled = false;
    btn.textContent = "Create Account";
  });

  // ---- Auth: Google ----
  document.getElementById("btn-google").addEventListener("click", () => Auth.loginWithGoogle());
  document.getElementById("btn-google-reg").addEventListener("click", () => Auth.loginWithGoogle());

  // ---- Auth: logout ----
  document.getElementById("btn-logout").addEventListener("click", () => {
    if (unsubQuestions) unsubQuestions();
    Auth.logout();
  });

  // ---- Toggle add-question form ----
  document.getElementById("toggle-add-form").addEventListener("click", () => {
    const isHidden = addFormBody.classList.contains("hidden");
    addFormBody.classList.toggle("hidden");
    toggleIcon.textContent = isHidden ? "−" : "+";
  });

  // ---- Add question ----
  document.getElementById("btn-add-question").addEventListener("click", async () => {
    const data = getFormData();
    if (!data.question) {
      showFormMsg("Please enter a question.", "error");
      return;
    }
    const btn = document.getElementById("btn-add-question");
    btn.disabled = true;
    btn.textContent = "Adding...";
    try {
      await Questions.add(data);
      clearForm();
      showFormMsg("Question added.", "success");
    } catch (err) {
      showFormMsg("Failed to add question. Check your Firebase config.", "error");
      console.error(err);
    }
    btn.disabled = false;
    btn.textContent = "Add Question";
  });

  // ---- Clear form ----
  document.getElementById("btn-clear-form").addEventListener("click", clearForm);

  // ---- Search & Filter ----
  searchInput.addEventListener("input", renderQuestions);
  filterDifficulty.addEventListener("change", renderQuestions);

  // ---- Delete modal ----
  document.getElementById("btn-cancel-delete").addEventListener("click", closeModal);
  document.getElementById("btn-confirm-delete").addEventListener("click", async () => {
    if (!deleteTargetId) return;
    const btn = document.getElementById("btn-confirm-delete");
    btn.disabled = true;
    btn.textContent = "Deleting...";
    try {
      await Questions.remove(deleteTargetId);
    } catch (err) {
      console.error("Delete failed:", err);
    }
    btn.disabled = false;
    btn.textContent = "Delete";
    closeModal();
  });

  // ---- Helpers ----

  function showAuth() {
    authScreen.classList.add("active");
    dashScreen.classList.remove("active");
  }

  function showDashboard(user) {
    authScreen.classList.remove("active");
    dashScreen.classList.add("active");
    userName.textContent = user.displayName || user.email;

    // Start listening to questions
    if (unsubQuestions) unsubQuestions();
    unsubQuestions = Questions.listen(questions => {
      allQuestions = questions;
      renderQuestions();
    });
  }

  function renderQuestions() {
    const search = searchInput.value.toLowerCase();
    const diffFilter = filterDifficulty.value;

    let filtered = allQuestions;
    if (search) {
      filtered = filtered.filter(q =>
        q.question.toLowerCase().includes(search) ||
        q.topic.toLowerCase().includes(search) ||
        q.claim.toLowerCase().includes(search)
      );
    }
    if (diffFilter !== "all") {
      filtered = filtered.filter(q => q.difficulty === diffFilter);
    }

    questionCount.textContent = filtered.length;

    if (filtered.length === 0) {
      questionsList.innerHTML = `<div class="empty-state"><p>${
        allQuestions.length === 0
          ? "No questions yet. Add your first CER question above."
          : "No questions match your search."
      }</p></div>`;
      return;
    }

    questionsList.innerHTML = filtered.map(q => {
      const date = q.createdAt
        ? new Date(q.createdAt.seconds * 1000).toLocaleDateString()
        : "";
      return `
        <div class="question-item" data-id="${q.id}">
          <div class="question-item-header">
            <div>
              <span class="question-topic">${esc(q.topic)}</span>
              <div class="question-text">${esc(q.question)}</div>
              <div class="question-meta">
                <span class="difficulty-badge ${q.difficulty}">${q.difficulty}</span>
                ${date ? `<span class="question-date">${date}</span>` : ""}
              </div>
            </div>
            <div class="question-actions">
              <button class="btn-icon" onclick="toggleCER('${q.id}')" title="Show CER">&#9662;</button>
              <button class="btn-icon danger" onclick="confirmDelete('${q.id}')" title="Delete">&times;</button>
            </div>
          </div>
          <div class="cer-details" id="cer-${q.id}">
            ${cerSection("Claim", q.claim)}
            ${cerSection("Evidence", q.evidence)}
            ${cerSection("Reasoning", q.reasoning)}
          </div>
        </div>`;
    }).join("");
  }

  function cerSection(label, value) {
    if (!value) return "";
    return `<div class="cer-section">
      <div class="cer-label">${label}</div>
      <div class="cer-value">${esc(value)}</div>
    </div>`;
  }

  function esc(str) {
    if (!str) return "";
    const d = document.createElement("div");
    d.textContent = str;
    return d.innerHTML;
  }

  function getFormData() {
    return {
      topic: document.getElementById("q-topic").value,
      question: document.getElementById("q-question").value,
      claim: document.getElementById("q-claim").value,
      evidence: document.getElementById("q-evidence").value,
      reasoning: document.getElementById("q-reasoning").value,
      difficulty: document.getElementById("q-difficulty").value
    };
  }

  function clearForm() {
    document.getElementById("q-topic").value = "";
    document.getElementById("q-question").value = "";
    document.getElementById("q-claim").value = "";
    document.getElementById("q-evidence").value = "";
    document.getElementById("q-reasoning").value = "";
    document.getElementById("q-difficulty").value = "medium";
    formMsg.classList.add("hidden");
  }

  function showFormMsg(msg, type) {
    formMsg.textContent = msg;
    formMsg.className = `form-msg ${type}`;
    setTimeout(() => formMsg.classList.add("hidden"), 4000);
  }

  function closeModal() {
    modalOverlay.classList.add("hidden");
    deleteTargetId = null;
  }

  // ---- Globals for inline handlers ----
  window.toggleCER = function (id) {
    const el = document.getElementById("cer-" + id);
    if (el) el.classList.toggle("open");
  };

  window.confirmDelete = function (id) {
    deleteTargetId = id;
    modalOverlay.classList.remove("hidden");
  };
})();
