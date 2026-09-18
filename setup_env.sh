#!/bin/bash
set -e

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}===============================================${NC}"
echo -e "${BLUE}=== Installing SecureLab Exam Dependencies ====${NC}"
echo -e "${BLUE}===============================================${NC}"

# 1. Update Package List
echo -e "\n${YELLOW}[1/4] Updating apt package list...${NC}"
if command -v sudo &>/dev/null; then
  sudo apt-get update -y
else
  apt-get update -y
fi

# 2. Install System Runtimes, Compilers, and Databases
echo -e "\n${YELLOW}[2/4] Installing Python, C/C++, Java, R, MySQL, and system packages...${NC}"
APT_PKGS=(
  python3
  python3-pip
  python3-venv
  python3-numpy
  python3-scipy
  python3-pandas
  python3-matplotlib
  python3-openpyxl
  gcc
  g++
  default-jdk
  r-base
  r-cran-plotrix
  mysql-server
  mysql-client
)

if command -v sudo &>/dev/null; then
  sudo apt-get install -y "${APT_PKGS[@]}" || true
  sudo apt-get install -y python3-sklearn 2>/dev/null || sudo apt-get install -y python3-scikitlearn 2>/dev/null || true
else
  apt-get install -y "${APT_PKGS[@]}" || true
  apt-get install -y python3-sklearn 2>/dev/null || apt-get install -y python3-scikitlearn 2>/dev/null || true
fi

# 3. Configure MySQL database
echo -e "\n${YELLOW}[3/4] Configuring MySQL Server & Dedicated User...${NC}"
if command -v systemctl &>/dev/null; then
  sudo systemctl start mysql 2>/dev/null || sudo service mysql start 2>/dev/null || true
  sudo systemctl enable mysql 2>/dev/null || true
elif command -v service &>/dev/null; then
  sudo service mysql start 2>/dev/null || true
fi

if command -v mysql &>/dev/null; then
  echo "Initializing 'labexam' database and dedicated user 'exam_user'..."
  sudo mysql -u root -e "CREATE DATABASE IF NOT EXISTS labexam;" 2>/dev/null || true
  sudo mysql -u root -e "CREATE USER IF NOT EXISTS 'exam_user'@'localhost' IDENTIFIED BY 'exam_password';" 2>/dev/null || true
  sudo mysql -u root -e "GRANT ALL PRIVILEGES ON *.* TO 'exam_user'@'localhost';" 2>/dev/null || true
  sudo mysql -u root -e "FLUSH PRIVILEGES;" 2>/dev/null || true
fi

# 4. Pre-initialize & Cache Dedicated Python Virtual Environment
echo -e "\n${YELLOW}[4/4] Pre-caching Dedicated Python Environment (~/.securemlexam-venv)...${NC}"
VENV_PATH="$HOME/.securemlexam-venv"
if [ ! -d "$VENV_PATH" ]; then
  python3 -m venv --system-site-packages "$VENV_PATH" 2>/dev/null || true
fi

if [ -f "$VENV_PATH/bin/pip" ]; then
  "$VENV_PATH/bin/pip" install --quiet --no-warn-script-location numpy pandas matplotlib scipy scikit-learn openpyxl 2>/dev/null || true
elif command -v pip3 &>/dev/null; then
  pip3 install --quiet --user --no-warn-script-location numpy pandas matplotlib scipy scikit-learn openpyxl 2>/dev/null || true
fi

echo -e "\n${BLUE}===============================================${NC}"
echo -e "${BLUE}=== Environment Verification Checklist ========${NC}"
echo -e "${BLUE}===============================================${NC}"

check_cmd() {
  local name="$1"
  local cmd="$2"
  if eval "$cmd" >/dev/null 2>&1; then
    echo -e "  [${GREEN}✔ OK${NC}] $name"
  else
    echo -e "  [${RED}✘ MISSING${NC}] $name"
  fi
}

check_py_lib() {
  local lib="$1"
  if python3 -c "import $lib" >/dev/null 2>&1; then
    echo -e "  [${GREEN}✔ OK${NC}] Python: $lib"
  elif [ -f "$VENV_PATH/bin/python3" ] && "$VENV_PATH/bin/python3" -c "import $lib" >/dev/null 2>&1; then
    echo -e "  [${GREEN}✔ OK${NC}] Python (venv): $lib"
  else
    echo -e "  [${RED}✘ MISSING${NC}] Python: $lib"
  fi
}

check_cmd "Python 3 Runtime" "python3 --version"
check_py_lib "numpy"
check_py_lib "pandas"
check_py_lib "matplotlib"
check_py_lib "scipy"
check_py_lib "sklearn"
check_py_lib "openpyxl"
check_cmd "GCC (C Compiler)" "gcc --version"
check_cmd "G++ (C++ Compiler)" "g++ --version"
check_cmd "Java (JDK)" "javac -version"
check_cmd "R / Rscript" "Rscript --version"
check_cmd "MySQL Client" "mysql --version"

echo -e "\n${GREEN}===============================================${NC}"
echo -e "${GREEN}=== Setup Completed Successfully! ============${NC}"
echo -e "${GREEN}===============================================${NC}"
