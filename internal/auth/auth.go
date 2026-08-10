package auth

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"
)

func HashPassword(password string) (string, error) {
	salt := make([]byte, 16)
	if _, err := rand.Read(salt); err != nil {
		return "", err
	}
	hash := deriveKey(password, salt, 100_000)
	return fmt.Sprintf("%s:%s", hex.EncodeToString(salt), hex.EncodeToString(hash)), nil
}

func VerifyPassword(stored, password string) bool {
	parts := strings.Split(stored, ":")
	if len(parts) != 2 {
		return false
	}
	salt, err := hex.DecodeString(parts[0])
	if err != nil {
		return false
	}
	want, err := hex.DecodeString(parts[1])
	if err != nil {
		return false
	}
	hash := deriveKey(password, salt, 100_000)
	if len(hash) != len(want) {
		return false
	}
	return hmac.Equal(want, hash)
}

func deriveKey(password string, salt []byte, iterations int) []byte {
	data := append([]byte(password), salt...)
	sum := sha256.Sum256(data)
	key := sum[:]
	for i := 1; i < iterations; i++ {
		next := append(append([]byte{}, key...), salt...)
		derived := sha256.Sum256(next)
		key = derived[:]
	}
	return append([]byte(nil), key...)
}

type Claims struct {
	Subject string
	Role    string
	Expiry  time.Time
}

type TokenManager struct {
	secret []byte
}

func NewTokenManager(secret string) *TokenManager {
	return &TokenManager{secret: []byte(secret)}
}

func (m *TokenManager) Sign(claims Claims) (string, error) {
	payload := fmt.Sprintf("%s|%s|%d", claims.Subject, claims.Role, claims.Expiry.Unix())
	sig := hmac.New(sha256.New, m.secret)
	_, _ = sig.Write([]byte(payload))
	return base64.RawURLEncoding.EncodeToString([]byte(payload)) + "." + base64.RawURLEncoding.EncodeToString(sig.Sum(nil)), nil
}

func (m *TokenManager) Verify(token string) (*Claims, error) {
	parts := strings.Split(token, ".")
	if len(parts) != 2 {
		return nil, errors.New("invalid token")
	}
	payloadBytes, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return nil, err
	}
	sigBytes, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return nil, err
	}
	expected := hmac.New(sha256.New, m.secret)
	_, _ = expected.Write(payloadBytes)
	if !hmac.Equal(sigBytes, expected.Sum(nil)) {
		return nil, errors.New("invalid signature")
	}
	fields := strings.Split(string(payloadBytes), "|")
	if len(fields) != 3 {
		return nil, errors.New("invalid token payload")
	}
	expiresAt, err := strconv.ParseInt(fields[2], 10, 64)
	if err != nil {
		return nil, err
	}
	claims := &Claims{Subject: fields[0], Role: fields[1], Expiry: time.Unix(expiresAt, 0)}
	if time.Now().After(claims.Expiry) {
		return nil, errors.New("token expired")
	}
	return claims, nil
}
