/**
 * 2D Virtual Dev Office - Realistic Simulation Data Engine
 * Generates comprehensive, production-ready deliverables for Demo / Simulation Mode.
 */

const SIMULATION_TEMPLATES = {
  // Preset 1: Authentication & Role Permission
  auth: {
    title: 'Sistem Autentikasi JWT & Role Permission (Admin, Manager, Staff)',
    description: 'Implementasi API login/register, token JWT, hashing password Argon2ID, dan middleware hak akses bertingkat dengan CodeIgniter 4 dan MySQL.',
    priority: 1,
    outputs: {
      scrum_master: `### 📋 SPRINT GOAL & USER STORY BREAKDOWN
**Project Scope:** Modul Autentikasi Terpusat & Kontrol Akses Berbasis Peran (RBAC)
**Assigned Sprint:** Sprint 01 - Core Foundation
**Estimated Velocity:** 13 Story Points

#### 1. User Stories & Acceptance Criteria:
- **US-01 [Auth Login]:** Sebagai pengguna, saya dapat masuk menggunakan email dan password untuk mendapatkan token sesi JWT yang valid selama 24 jam.
  - *Kriteria Penerimaan:* Password diverifikasi dengan algoritma Argon2ID/Bcrypt; brute-force rate limit 5 percobaan/menit; return JWT claims: sub, email, role, exp.
- **US-02 [RBAC Middleware]:** Sebagai sistem, setiap request ke protected endpoint harus memeriksa header \`Authorization: Bearer <token>\` dan memvalidasi izin role.
  - *Kriteria Penerimaan:* Role terbagi: \`admin\` (full access), \`manager\` (read/write non-destructive), \`staff\` (read-only); status HTTP 403 Forbidden jika role tidak sesuai.
- **US-03 [Session Invalidation]:** Logout harus memasukkan token ke blocklist/revoke table.

#### 2. Technical Workflow Handoff:
- ➔ **DB Architect:** Rancang skema 5 tabel (\`users\`, \`roles\`, \`permissions\`, \`role_permissions\`, \`revoked_tokens\`) beserta indeks email & FK constraints.
- ➔ **Backend Dev:** Tulis Controller, Model, Auth Filter, dan generator JWT di CodeIgniter 4.
- ➔ **Frontend Dev:** Tulis template UI Login/Register modal, fetch wrapper, dan state token handler.
- ➔ **QA Engineer:** Audit kerentanan SQLi, timing attack, replay attack, dan CSRF protection.`,

      system_architect: `### 🗄️ DATABASE ARCHITECTURE & API CONTRACT SPECIFICATION
**Engine:** MySQL 8.0+ / InnoDB / \`utf8mb4_unicode_ci\`
**Designed by:** Bram (System Architect)

#### 1. Relational Database Schema (MySQL DDL):
\`\`\`sql
-- 1. Table: Roles
CREATE TABLE \`roles\` (
  \`id\` INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  \`name\` VARCHAR(50) NOT NULL UNIQUE,
  \`description\` VARCHAR(255) NULL,
  \`created_at\` DATETIME DEFAULT CURRENT_TIMESTAMP,
  \`updated_at\` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2. Table: Users
CREATE TABLE \`users\` (
  \`id\` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  \`role_id\` INT UNSIGNED NOT NULL,
  \`name\` VARCHAR(100) NOT NULL,
  \`email\` VARCHAR(150) NOT NULL UNIQUE,
  \`password_hash\` VARCHAR(255) NOT NULL,
  \`status\` ENUM('active', 'suspended', 'pending') DEFAULT 'active',
  \`last_login_at\` DATETIME NULL,
  \`created_at\` DATETIME DEFAULT CURRENT_TIMESTAMP,
  \`updated_at\` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX \`idx_users_email\` (\`email\`),
  INDEX \`idx_users_role_id\` (\`role_id\`),
  CONSTRAINT \`fk_users_role\` FOREIGN KEY (\`role_id\`) REFERENCES \`roles\` (\`id\`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3. Table: Revoked Tokens (Logout Blacklist)
CREATE TABLE \`revoked_tokens\` (
  \`id\` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  \`token_hash\` VARCHAR(64) NOT NULL UNIQUE,
  \`user_id\` BIGINT UNSIGNED NOT NULL,
  \`expires_at\` DATETIME NOT NULL,
  \`created_at\` DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX \`idx_revoked_expiry\` (\`expires_at\`),
  CONSTRAINT \`fk_tokens_user\` FOREIGN KEY (\`user_id\`) REFERENCES \`users\` (\`id\`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Initial Seed Data
INSERT INTO \`roles\` (\`name\`, \`description\`) VALUES
('admin', 'Super Administrator with full system control'),
('manager', 'Operational Manager with approval capabilities'),
('staff', 'Regular employee with standard read-only access');
\`\`\`

#### 2. REST API Contract:
- **POST** \`/api/v1/auth/login\`
  - *Request Body:* \`{ "email": "admin@office.local", "password": "SuperSecretPassword123!" }\`
  - *Response (200 OK):*
    \`\`\`json
    {
      "status": "success",
      "message": "Authentication successful",
      "data": {
        "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
        "user": {
          "id": 1,
          "name": "Super Admin",
          "email": "admin@office.local",
          "role": "admin"
        },
        "expires_in": 86400
      }
    }
    \`\`\``,

      backend_dev: `### ⚙️ BACKEND CODE IMPLEMENTATION (CodeIgniter 4 & PHP 8.2)
**Author:** Reza (Senior Backend Dev)
**Stack:** CodeIgniter 4, MySQL, Firebase JWT, Password Hashing API

#### File 1: \`app/Controllers/Api/AuthController.php\`
\`\`\`php
<?php

namespace App\\Controllers\\Api;

use CodeIgniter\\RESTful\\ResourceController;
use App\\Models\\UserModel;
use Firebase\\JWT\\JWT;
use Firebase\\JWT\\Key;

class AuthController extends ResourceController
{
    protected $format = 'json';

    public function login()
    {
        $rules = [
            'email'    => 'required|valid_email',
            'password' => 'required|min_length[8]'
        ];

        if (!$this->validate($rules)) {
            return $this->failValidationErrors($this->validator->getErrors());
        }

        $email = $this->request->getVar('email');
        $password = $this->request->getVar('password');

        $userModel = new UserModel();
        $user = $userModel->select('users.*, roles.name as role_name')
                          ->join('roles', 'roles.id = users.role_id')
                          ->where('users.email', $email)
                          ->first();

        if (!$user || !password_verify($password, $user['password_hash'])) {
            return $this->failUnauthorized('Kredensial email atau password tidak valid.');
        }

        if ($user['status'] !== 'active') {
            return $this->failForbidden('Akun Anda sedang dinonaktifkan atau ditangguhkan.');
        }

        // Generate JWT Token
        $issuedAt = time();
        $expireTime = $issuedAt + (60 * 60 * 24); // 24 Hours
        $payload = [
            'iss'  => base_url(),
            'aud'  => base_url(),
            'iat'  => $issuedAt,
            'exp'  => $expireTime,
            'sub'  => $user['id'],
            'email'=> $user['email'],
            'role' => $user['role_name']
        ];

        $secretKey = getenv('JWT_SECRET_KEY') ?: 'SuperSecretSecureKeyDevOffice999#';
        $token = JWT::encode($payload, $secretKey, 'HS256');

        // Update login timestamp
        $userModel->update($user['id'], ['last_login_at' => date('Y-m-d H:i:s')]);

        return $this->respond([
            'status'     => 'success',
            'message'    => 'Login berhasil',
            'token'      => $token,
            'user'       => [
                'id'    => (int)$user['id'],
                'name'  => esc($user['name']),
                'email' => esc($user['email']),
                'role'  => $user['role_name']
            ],
            'expires_in' => 86400
        ]);
    }

    public function logout()
    {
        // Token revocation logic
        return $this->respond([
            'status'  => 'success',
            'message' => 'Sesi berhasil diakhiri.'
        ]);
    }
}
\`\`\`

#### File 2: \`app/Filters/JwtAuthFilter.php\` (Middleware)
\`\`\`php
<?php

namespace App\\Filters;

use CodeIgniter\\Filters\\FilterInterface;
use CodeIgniter\\HTTP\\RequestInterface;
use CodeIgniter\\HTTP\\ResponseInterface;
use Firebase\\JWT\\JWT;
use Firebase\\JWT\\Key;
use Config\\Services;

class JwtAuthFilter implements FilterInterface
{
    public function before(RequestInterface $request, $arguments = null)
    {
        $header = $request->getHeaderLine('Authorization');
        if (empty($header) || !preg_match('/Bearer\\s(\\S+)/', $header, $matches)) {
            return Services::response()
                ->setJSON(['status' => 'error', 'message' => 'Token autentikasi tidak ditemukan.'])
                ->setStatusCode(401);
        }

        try {
            $token = $matches[1];
            $key = getenv('JWT_SECRET_KEY') ?: 'SuperSecretSecureKeyDevOffice999#';
            $decoded = JWT::decode($token, new Key($key, 'HS256'));
            
            // Attach user payload to request
            $request->user = $decoded;
            return $request;
        } catch (\\Exception $e) {
            return Services::response()
                ->setJSON(['status' => 'error', 'message' => 'Sesi tidak valid atau telah kadaluarsa.'])
                ->setStatusCode(401);
        }
    }

    public function after(RequestInterface $request, ResponseInterface $response, $arguments = null)
    {
        // No-op
    }
}
\`\`\``,

      frontend_dev: `### 💻 FRONTEND UI & JAVASCRIPT AJAX INTEGRATION
**Author:** Maya (Frontend / JS Dev)
**Stack:** Semantic HTML5, CSS Glassmorphism, Modern Vanilla JS (ES6+ Fetch API)

#### File 1: \`public/login.html\`
\`\`\`html
<div class="auth-card">
  <div class="auth-header">
    <h2 class="auth-title">🏢 Masuk ke Sistem</h2>
    <p class="auth-subtitle">Masukkan kredensial akun perusahaan Anda</p>
  </div>

  <form id="loginForm" class="auth-form" onsubmit="handleAuthSubmit(event)">
    <div class="input-group">
      <label for="email" class="form-label">Email Kantor</label>
      <input type="email" id="email" class="form-control" placeholder="nama@perusahaan.com" required autocomplete="email">
    </div>

    <div class="input-group">
      <label for="password" class="form-label">Kata Sandi</label>
      <input type="password" id="password" class="form-control" placeholder="••••••••" required autocomplete="current-password">
    </div>

    <div class="form-actions">
      <label class="remember-me">
        <input type="checkbox" id="rememberMe"> Ingat sesi saya
      </label>
      <button type="submit" id="btnSubmit" class="btn-primary">
        <span id="btnText">Masuk Sekarang</span>
        <span id="btnSpinner" class="spinner hidden"></span>
      </button>
    </div>

    <div id="authAlert" class="alert-box hidden" role="alert"></div>
  </form>
</div>
\`\`\`

#### File 2: \`public/js/auth-client.js\`
\`\`\`javascript
/**
 * Modern Client-Side Authentication Service
 */
const API_BASE = '/api/v1/auth';

async function handleAuthSubmit(event) {
  event.preventDefault();

  const email = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value;
  const btnSubmit = document.getElementById('btnSubmit');
  const btnText = document.getElementById('btnText');
  const btnSpinner = document.getElementById('btnSpinner');
  const alertBox = document.getElementById('authAlert');

  // Reset Alert
  alertBox.className = 'alert-box hidden';
  btnSubmit.disabled = true;
  btnText.textContent = 'Memverifikasi...';
  btnSpinner.classList.remove('hidden');

  try {
    const response = await fetch(\`\${API_BASE}/login\`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'X-Requested-With': 'XMLHttpRequest'
      },
      body: JSON.stringify({ email, password })
    });

    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.message || 'Gagal melakukan otentikasi akun.');
    }

    // Simpan token secara aman
    sessionStorage.setItem('auth_token', result.token);
    sessionStorage.setItem('user_profile', JSON.stringify(result.user));

    showAlert('success', '✓ Login berhasil! Mengarahkan ke dashboard...');

    setTimeout(() => {
      window.location.href = '/dashboard';
    }, 800);

  } catch (error) {
    showAlert('danger', \`⚠ \${error.message}\`);
  } finally {
    btnSubmit.disabled = false;
    btnText.textContent = 'Masuk Sekarang';
    btnSpinner.classList.add('hidden');
  }
}

function showAlert(type, message) {
  const alertBox = document.getElementById('authAlert');
  alertBox.textContent = message;
  alertBox.className = \`alert-box alert-\${type}\`;
}
\`\`\``,

      qa_engineer: `### 🛡️ QA VALIDATION & SECURITY AUDIT REPORT
**Auditor:** Dimas (QA & Security Engineer)
**Audit Status:** APPROVED (PASSED WITH RECOMMENDATIONS)
**Target:** JWT Authentication & RBAC Service

#### 1. Security Vulnerability Assessment Matrix:
| Attack Vector | Assessment Result | Remediation Applied |
| :--- | :---: | :--- |
| **SQL Injection (SQLi)** | ✅ PASSED | Menggunakan CodeIgniter 4 Query Builder dengan Parameterized Binding. Bebas dari string concatenation. |
| **Cross-Site Scripting (XSS)** | ✅ PASSED | Output disanitasi menggunakan helper \`esc()\` pada nama pengguna dan header content-type \`application/json\`. |
| **Brute Force Protection** | ⚠️ WARNING | Rekomendasi: Pasang Redis-based Throttler (maks 5 percobaan gagal per IP/akun per 5 menit). |
| **JWT Signature Flaw** | ✅ PASSED | Algoritma ditegaskan secara ketat \`HS256\`, menolak manipulasi token header \`"alg": "none"\`. |
| **Timing Attacks** | ✅ PASSED | Menggunakan fungsi native \`password_verify()\` yang menggunakan constant-time string comparison. |

#### 2. Test Execution Suite:
- [x] **Test 1:** Login dengan email terdaftar dan password benar ➔ Return 200 OK & valid JWT.
- [x] **Test 2:** Login dengan password salah ➔ Return 401 Unauthorized tanpa membocorkan eksistensi user.
- [x] **Test 3:** Akses protected route tanpa header Authorization ➔ Return 401 Unauthorized.
- [x] **Test 4:** Akses endpoint admin dengan user role 'staff' ➔ Return 403 Forbidden.
- [x] **Test 5:** Token kadaluarsa (expired timestamp) ➔ Gracefully rejected dengan status 401.

**Final Deliverable Verdict:** Modul ini telah memenuhi standar clean architecture, secure coding guidelines, dan siap dirilis ke staging.`
    }
  },

  // Preset 2: Inventory & Stock Management
  inventory: {
    title: 'Modul Manajemen Produk & Peringatan Stok Rendah (REST API & Alert)',
    description: 'CRUD produk inventaris, log pergerakan stok (in/out), perhitungan otomatis, dan trigger peringatan jika stok di bawah ambang batas (low stock alert).',
    priority: 2,
    outputs: {
      scrum_master: `### 📋 SPRINT GOAL & USER STORY BREAKDOWN
**Project Scope:** Modul Manajemen Inventaris Produk & Automated Low-Stock Alert
**Assigned Sprint:** Sprint 02 - Operations Management

#### User Stories:
- **US-01 [Product Catalog]:** Admin dapat menambah, mengubah, dan melihat daftar produk inventaris beserta SKU unik dan harga.
- **US-02 [Stock Movement Ledger]:** Setiap penambahan atau pengurangan stok harus dicatat dalam tabel audit trail (\`stock_logs\`).
- **US-03 [Automated Low-Stock Trigger]:** Sistem otomatis menandai status produk menjadi \`low_stock\` jika quantity <= minimum_threshold dan mengirimkan signal event alert.`,

      system_architect: `### 🗄️ DATABASE SCHEMA & API SPECIFICATION
\`\`\`sql
-- Products Table
CREATE TABLE \`products\` (
  \`id\` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  \`sku\` VARCHAR(60) NOT NULL UNIQUE,
  \`name\` VARCHAR(200) NOT NULL,
  \`category\` VARCHAR(100) NOT NULL,
  \`stock_qty\` INT NOT NULL DEFAULT 0,
  \`min_stock_alert\` INT NOT NULL DEFAULT 10,
  \`unit_price\` DECIMAL(15, 2) NOT NULL DEFAULT 0.00,
  \`status\` ENUM('in_stock', 'low_stock', 'out_of_stock') DEFAULT 'in_stock',
  \`created_at\` DATETIME DEFAULT CURRENT_TIMESTAMP,
  \`updated_at\` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX \`idx_products_sku\` (\`sku\`),
  INDEX \`idx_products_status\` (\`status\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Stock Movement Logs (Audit Trail)
CREATE TABLE \`stock_logs\` (
  \`id\` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  \`product_id\` BIGINT UNSIGNED NOT NULL,
  \`change_type\` ENUM('in', 'out', 'adjustment') NOT NULL,
  \`quantity\` INT NOT NULL,
  \`previous_stock\` INT NOT NULL,
  \`current_stock\` INT NOT NULL,
  \`notes\` VARCHAR(255) NULL,
  \`created_at\` DATETIME DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT \`fk_stock_product\` FOREIGN KEY (\`product_id\`) REFERENCES \`products\` (\`id\`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
\`\`\``,

      backend_dev: `### ⚙️ BACKEND CONTROLLER & TRANSACTIONAL STOCK ENGINE
\`\`\`php
<?php

namespace App\\Controllers\\Api;

use CodeIgniter\\RESTful\\ResourceController;
use App\\Models\\ProductModel;
use App\\Models\\StockLogModel;

class ProductController extends ResourceController
{
    protected $format = 'json';

    public function adjustStock($id = null)
    {
        $db = \\Config\\Database::connect();
        $db->transBegin();

        try {
            $productModel = new ProductModel();
            $product = $productModel->find($id);

            if (!$product) {
                return $this->failNotFound('Produk tidak ditemukan.');
            }

            $type = $this->request->getVar('type'); // 'in' or 'out'
            $qty = (int)$this->request->getVar('quantity');
            $notes = $this->request->getVar('notes');

            $currentStock = (int)$product['stock_qty'];
            $newStock = ($type === 'in') ? ($currentStock + $qty) : ($currentStock - $qty);

            if ($newStock < 0) {
                return $this->fail('Stok tidak mencukupi untuk pengurangan ini.');
            }

            // Determine status alert
            $status = 'in_stock';
            if ($newStock == 0) {
                $status = 'out_of_stock';
            } elseif ($newStock <= (int)$product['min_stock_alert']) {
                $status = 'low_stock';
            }

            // Update Product
            $productModel->update($id, [
                'stock_qty' => $newStock,
                'status'    => $status
            ]);

            // Insert Audit Log
            $logModel = new StockLogModel();
            $logModel->insert([
                'product_id'     => $id,
                'change_type'    => $type,
                'quantity'       => $qty,
                'previous_stock' => $currentStock,
                'current_stock'  => $newStock,
                'notes'          => esc($notes)
            ]);

            $db->transCommit();

            return $this->respond([
                'status'  => 'success',
                'message' => 'Stok produk berhasil diperbarui',
                'data'    => [
                    'sku'          => $product['sku'],
                    'new_stock'    => $newStock,
                    'stock_status' => $status
                ]
            ]);

        } catch (\\Exception $e) {
            $db->transRollback();
            return $this->failServerError($e->getMessage());
        }
    }
}
\`\`\``,

      frontend_dev: `### 💻 INVENTORY TABLE & REAL-TIME STOCK BADGE
\`\`\`html
<div class="inventory-table-container">
  <table class="data-table">
    <thead>
      <tr>
        <th>SKU</th>
        <th>Nama Produk</th>
        <th>Stok Saat Ini</th>
        <th>Ambang Min</th>
        <th>Status</th>
        <th>Aksi</th>
      </tr>
    </thead>
    <tbody id="inventoryList">
      <!-- Rendered via JavaScript -->
    </tbody>
  </table>
</div>

<script>
function renderStockBadge(status, qty) {
  if (status === 'out_of_stock') {
    return \`<span class="badge badge-danger">Habis (0)</span>\`;
  } else if (status === 'low_stock') {
    return \`<span class="badge badge-warning">⚠ Peringatan Stok Rendah (\${qty})</span>\`;
  }
  return \`<span class="badge badge-success">Aman (\${qty})</span>\`;
}
</script>
\`\`\``,

      qa_engineer: `### 🛡️ QA VERIFICATION: ACID TRANSACTION & CONCURRENCY
- [x] **Race Condition Prevention:** Transaksi database menggunakan \`transBegin()\` dan locking agar tidak terjadi inkonsistensi stok saat 2 kasir checkout bersamaan.
- [x] **Boundary Testing:** Pengujian pengurangan stok melampaui 0 berhasil ditolak sistem.
- [x] **Audit Trail Verification:** Setiap perubahan stok sukses tercatat di tabel \`stock_logs\`.`
    }
  }
};

/**
 * Dynamic Simulation Generator for Custom Tasks
 * When the user enters any custom task in Demo Mode, this generates tailored deliverables.
 */
class SimulationEngine {
  static getPreset(key) {
    return SIMULATION_TEMPLATES[key] || null;
  }

  static generateCustomDeliverables(taskTitle, taskDesc) {
    const cleanTitle = taskTitle || 'Custom Feature Implementation';
    const cleanDesc = taskDesc || 'Implementasi modul sesuai kebutuhan sprint.';

    return {
      scrum_master: `### 📋 SCRUM MASTER ANALYSIS & SPRINT BREAKDOWN
**Task Title:** ${cleanTitle}
**Task Description:** ${cleanDesc}
**Sprint Lead:** Citra (Scrum Master)

#### 1. Scope Breakdown & User Stories:
- **US-01:** Sebagai pengguna, sistem menyediakan endpoint dan antarmuka untuk fitur **"${cleanTitle}"** dengan alur kerja yang mudah dipahami.
- **US-02:** Sistem melakukan validasi ketat pada input data, menangani kegagalan jaringan secara anggun, dan memberikan respons JSON terstruktur.
- **US-03:** Semua interaksi data tersimpan dengan integritas relasional tinggi dan perlindungan audit trail.

#### 2. Technical Delegation:
- ➔ **DB Architect:** Rancang tabel relasional yang dioptimalkan dengan indeks primer dan foreign key.
- ➔ **Backend Dev:** Implementasikan Controller & Model dengan validasi server-side dan arsitektur modular.
- ➔ **Frontend Dev:** Buat komponen UI interaktif yang responsif dengan komunikasi AJAX.
- ➔ **QA Engineer:** Lakukan pengujian fungsional dan analisis kerentanan keamanan OWASP Top 10.`,

      system_architect: `### 🗄️ DATABASE ARCHITECTURE & API CONTRACT
**Architect:** Bram (System Architect)
**Target Module:** ${cleanTitle}

#### 1. Database Schema DDL (MySQL 8.0+):
\`\`\`sql
-- Primary Data Table for ${cleanTitle}
CREATE TABLE \`feature_records\` (
  \`id\` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  \`reference_code\` VARCHAR(64) NOT NULL UNIQUE,
  \`title\` VARCHAR(200) NOT NULL,
  \`payload_data\` JSON NULL,
  \`status\` ENUM('pending', 'in_progress', 'completed', 'archived') DEFAULT 'pending',
  \`created_by\` BIGINT UNSIGNED NOT NULL,
  \`created_at\` DATETIME DEFAULT CURRENT_TIMESTAMP,
  \`updated_at\` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX \`idx_feature_ref\` (\`reference_code\`),
  INDEX \`idx_feature_status\` (\`status\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
\`\`\`

#### 2. REST Endpoint Contract:
- **POST** \`/api/v1/resource\` ➔ Simpan data baru
- **GET** \`/api/v1/resource\` ➔ Ambil daftar terfilter & terpaginasi
- **PUT** \`/api/v1/resource/:id\` ➔ Perbarui status record`,

      backend_dev: `### ⚙️ MODULAR BACKEND IMPLEMENTATION (PHP 8.2 & CodeIgniter 4)
**Author:** Reza (Senior Backend Dev)

\`\`\`php
<?php

namespace App\\Controllers\\Api;

use CodeIgniter\\RESTful\\ResourceController;

class FeatureController extends ResourceController
{
    protected $format = 'json';

    public function create()
    {
        $rules = [
            'title' => 'required|min_length[3]|max_length[200]',
        ];

        if (!$this->validate($rules)) {
            return $this->failValidationErrors($this->validator->getErrors());
        }

        $title = $this->request->getVar('title');
        $referenceCode = 'REF-' . strtoupper(bin2hex(random_bytes(4)));

        // Persist to database securely
        $data = [
            'reference_code' => $referenceCode,
            'title'          => esc($title),
            'status'         => 'pending',
            'created_at'     => date('Y-m-d H:i:s')
        ];

        return $this->respondCreated([
            'status'  => 'success',
            'message' => 'Data untuk "${cleanTitle}" berhasil disimpan.',
            'data'    => $data
        ]);
    }
}
\`\`\``,

      frontend_dev: `### 💻 FRONTEND USER INTERFACE & AJAX CLIENT
**Author:** Maya (Frontend / JS Dev)

\`\`\`html
<div class="custom-feature-container">
  <div class="feature-header">
    <h3>${cleanTitle}</h3>
    <p>${cleanDesc}</p>
  </div>
  
  <div class="action-card">
    <button id="btnExecuteFeature" class="btn-primary" onclick="executeFeatureAction()">
      🚀 Jalankan Proses
    </button>
    <div id="featureResult" class="output-console"></div>
  </div>
</div>

<script>
async function executeFeatureAction() {
  const resultDiv = document.getElementById('featureResult');
  resultDiv.innerHTML = '<span class="text-cyan">Memproses request...</span>';

  try {
    const res = await fetch('/api/v1/resource', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: '${cleanTitle}' })
    });
    const data = await res.json();
    resultDiv.innerHTML = \`<pre class="code-box">\${JSON.stringify(data, null, 2)}</pre>\`;
  } catch (err) {
    resultDiv.innerHTML = \`<span class="text-red">Error: \${err.message}</span>\`;
  }
}
</script>
\`\`\``,

      qa_engineer: `### 🛡️ QA VALIDATION & SECURITY AUDIT SUMMARY
**Auditor:** Dimas (QA & Security Engineer)
**Status:** PASSING (Ready for Production)

#### Checklist:
1. ✅ **Input Sanitization:** Parameter diproteksi dari XSS dan script injection.
2. ✅ **Idempotency & Integrity:** Foreign key constraints terpasang dengan benar di skema database.
3. ✅ **Error Handling:** Tidak membocorkan stack trace sensitif ke respon klien publik.
4. ✅ **Clean Architecture:** Alur kerja modular dari Database ➔ Backend ➔ Frontend terhubung sempurna.`
    };
  }
}
