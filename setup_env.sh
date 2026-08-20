#!/bin/bash
set -e

echo "==============================================="
echo "=== Installing Secure Exam Dependencies ==="
echo "==============================================="

# 1. Update Package List
echo "Updating apt package list..."
sudo apt-get update -y

# 2. Install Python, C/C++, Java, R, MySQL
echo "Installing compilers, runtimes, and databases..."
sudo apt-get install -y \
  python3 \
  python3-pip \
  python3-venv \
  python3-numpy \
  python3-scipy \
  python3-pandas \
  python3-matplotlib \
  python3-openpyxl \
  python3-sklearn \
  gcc \
  g++ \
  default-jdk \
  r-base \
  r-cran-plotrix \
  mysql-server \
  mysql-client

# 3. Configure MySQL database
echo "Configuring MySQL Server..."
sudo systemctl start mysql || sudo service mysql start
sudo systemctl enable mysql || true

# Create database 'labexam' and set permissions
echo "Initializing 'labexam' database and dedicated user 'exam_user'..."
sudo mysql -u root -e "CREATE DATABASE IF NOT EXISTS labexam;"
sudo mysql -u root -e "CREATE USER IF NOT EXISTS 'exam_user'@'localhost' IDENTIFIED BY 'exam_password';"
sudo mysql -u root -e "GRANT ALL PRIVILEGES ON labexam.* TO 'exam_user'@'localhost';"
sudo mysql -u root -e "FLUSH PRIVILEGES;"

echo "==============================================="
echo "=== Environment Verification ==="
echo "==============================================="
python3 --version || echo "Python 3: FAILED"
gcc --version | head -n 1 || echo "GCC: FAILED"
g++ --version | head -n 1 || echo "G++: FAILED"
java -version 2>&1 | head -n 1 || echo "Java: FAILED"
Rscript --version || echo "Rscript: FAILED"
mysql --version || echo "MySQL: FAILED"

echo "==============================================="
echo "=== Setup Completed Successfully! ==="
echo "==============================================="
