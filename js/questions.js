// ============================================
// CER Questions Module
// ============================================

const Questions = (() => {
  const COLLECTION = "cer_questions";

  // Add a new question
  async function add(data) {
    const doc = {
      topic: data.topic.trim(),
      question: data.question.trim(),
      claim: data.claim.trim(),
      evidence: data.evidence.trim(),
      reasoning: data.reasoning.trim(),
      difficulty: data.difficulty,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      createdBy: auth.currentUser ? auth.currentUser.uid : null
    };
    const ref = await db.collection(COLLECTION).add(doc);
    return ref.id;
  }

  // Delete a question
  async function remove(id) {
    await db.collection(COLLECTION).doc(id).delete();
  }

  // Update a question
  async function update(id, data) {
    await db.collection(COLLECTION).doc(id).update({
      topic: data.topic.trim(),
      question: data.question.trim(),
      claim: data.claim.trim(),
      evidence: data.evidence.trim(),
      reasoning: data.reasoning.trim(),
      difficulty: data.difficulty,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
  }

  // Listen for real-time updates
  function listen(callback) {
    return db.collection(COLLECTION)
      .orderBy("createdAt", "desc")
      .onSnapshot(snapshot => {
        const questions = [];
        snapshot.forEach(doc => {
          questions.push({ id: doc.id, ...doc.data() });
        });
        callback(questions);
      }, err => {
        console.error("Firestore listen error:", err);
        callback([]);
      });
  }

  return { add, remove, update, listen };
})();
