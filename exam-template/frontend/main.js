const API = 'http://localhost:8081';
const out = document.getElementById('out');

async function calculate() {
  const price = document.getElementById('price').value;
  const percent = document.getElementById('percent').value;
  out.className = '';
  out.textContent = 'Calculando...';
  try {
    const res = await fetch(`${API}/api/price?price=${price}&percent=${percent}`);
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || body.message || `HTTP ${res.status}`);
    out.textContent = `Precio final: $${body.finalPrice}`;
  } catch (e) {
    out.className = 'error';
    out.textContent = `Error: ${e.message}`;
  }
}

document.getElementById('calc').onclick = calculate;
calculate();
