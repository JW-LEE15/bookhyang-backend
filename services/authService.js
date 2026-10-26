// services/authService.js
const supabase = require('../config/supabase');

// 1. 회원가입
const signUp = async (email, password, name) => {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { name }, // 사용자 메타데이터 (이름 등)
    },
  });

  if (error) throw error;
  return data;
};

// 2. 로그인
const signIn = async (email, password) => {
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) throw error;
  return data; // access_token, user 정보 포함
};

module.exports = {
  signUp,
  signIn,
};