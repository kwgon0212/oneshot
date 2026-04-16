import React from 'react';

interface InputToastProps {
  text: string;
  show: boolean;
}

const InputToast: React.FC<InputToastProps> = ({ text, show }) => (
  <div id="input-toast" className={`badge${show ? ' show' : ''}`}>
    {text}
  </div>
);

export default InputToast;
