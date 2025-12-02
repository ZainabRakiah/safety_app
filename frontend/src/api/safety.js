export async function getSafetyScore(lat, lng) {
  const res = await fetch("http://127.0.0.1:5001/api/safety-score", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ lat, lng }),
  });

  const data = await res.json();
  return data.safety_score;
}
