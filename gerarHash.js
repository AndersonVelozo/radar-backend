const bcrypt = require("bcryptjs");

(async () => {
  const senha = "123456789"; // coloque aqui a senha REAL que você quer usar
  const hash = await bcrypt.hash(senha, 10);
  console.log("HASH GERADO:", hash);
})();
